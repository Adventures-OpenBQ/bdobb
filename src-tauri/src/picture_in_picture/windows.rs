// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

//! Chrome's English PiP window on Windows. Coordinates at this boundary are
//! physical pixels, including the original restore frame across DPI changes.
//! Win32 signatures follow Microsoft Learn's winuser/processthreadsapi docs.
use super::{
    logic::{Rect, Status},
    windows_grab::{Grab, Player, PlayerKey, Windows},
};
use std::{
    ffi::c_void,
    ptr,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Mutex, Once, OnceLock, PoisonError,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{WebviewWindow, WindowEvent};

type Handle = *mut c_void;
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct WinRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}
#[repr(C)]
#[derive(Default)]
struct Point {
    x: i32,
    y: i32,
}
#[repr(C)]
#[derive(Default)]
struct FileTime {
    low: u32,
    high: u32,
}
#[link(name = "user32")]
extern "system" {
    fn EnumWindows(callback: unsafe extern "system" fn(Handle, isize) -> i32, data: isize) -> i32;
    fn IsWindowVisible(hwnd: Handle) -> i32;
    fn IsWindow(hwnd: Handle) -> i32;
    fn IsIconic(hwnd: Handle) -> i32;
    fn IsHungAppWindow(hwnd: Handle) -> i32;
    fn GetWindowTextW(hwnd: Handle, text: *mut u16, length: i32) -> i32;
    fn GetClassNameW(hwnd: Handle, text: *mut u16, length: i32) -> i32;
    fn GetWindowThreadProcessId(hwnd: Handle, pid: *mut u32) -> u32;
    fn GetWindowLongPtrW(hwnd: Handle, index: i32) -> isize;
    fn GetWindowRect(hwnd: Handle, rect: *mut WinRect) -> i32;
    fn SetWindowPos(hwnd: Handle, after: Handle, x: i32, y: i32, w: i32, h: i32, flags: u32)
        -> i32;
    fn GetForegroundWindow() -> Handle;
    fn ClientToScreen(hwnd: Handle, point: *mut Point) -> i32;
    fn GetDpiForWindow(hwnd: Handle) -> u32;
    fn EnumDisplayMonitors(
        hdc: Handle,
        clip: *const WinRect,
        callback: unsafe extern "system" fn(Handle, Handle, *mut WinRect, isize) -> i32,
        data: isize,
    ) -> i32;
    fn GetPropW(hwnd: Handle, key: *const u16) -> Handle;
    fn SetPropW(hwnd: Handle, key: *const u16, value: Handle) -> i32;
    fn RemovePropW(hwnd: Handle, key: *const u16) -> Handle;
}
#[link(name = "kernel32")]
extern "system" {
    fn CreateMutexW(attributes: *const c_void, owner: i32, name: *const u16) -> Handle;
    fn WaitForSingleObject(handle: Handle, timeout: u32) -> u32;
    fn ReleaseMutex(handle: Handle) -> i32;
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
    fn CloseHandle(handle: Handle) -> i32;
    fn QueryFullProcessImageNameW(
        process: Handle,
        flags: u32,
        text: *mut u16,
        length: *mut u32,
    ) -> i32;
    fn GetProcessTimes(
        process: Handle,
        created: *mut FileTime,
        exit: *mut FileTime,
        kernel: *mut FileTime,
        user: *mut FileTime,
    ) -> i32;
}
fn property() -> &'static [u16] {
    static KEY: OnceLock<Vec<u16>> = OnceLock::new();
    KEY.get_or_init(|| {
        "BDOBB.ChromePiP.Owner"
            .encode_utf16()
            .chain(Some(0))
            .collect()
    })
}
fn text(hwnd: Handle, class: bool) -> String {
    let mut value = [0u16; 256];
    // SAFETY: the fixed buffer is writable for its declared UTF-16 length.
    let count = unsafe {
        if class {
            GetClassNameW(hwnd, value.as_mut_ptr(), value.len() as i32)
        } else {
            GetWindowTextW(hwnd, value.as_mut_ptr(), value.len() as i32)
        }
    };
    String::from_utf16_lossy(&value[..count.max(0) as usize])
}
/// Discovery/movement eligibility may change without ending this HWND's lifetime.
fn eligible(hwnd: Handle) -> bool {
    let title = text(hwnd, false);
    let shown = unsafe { IsWindowVisible(hwnd) != 0 && GetWindowLongPtrW(hwnd, -20) & 8 != 0 };
    shown && (title.eq_ignore_ascii_case("Picture in picture") || title.eq_ignore_ascii_case("Picture-in-Picture"))
        && text(hwnd, true) == "Chrome_WidgetWin_1"
}
fn chrome_identity(hwnd: Handle) -> Option<(u32, u64)> {
    if unsafe { IsWindow(hwnd) } == 0 || text(hwnd, true) != "Chrome_WidgetWin_1" {
        return None;
    }
    let mut pid = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    // PROCESS_QUERY_LIMITED_INFORMATION only, never process injection/VM access.
    let process = unsafe { OpenProcess(0x1000, 0, pid) };
    if process.is_null() {
        return None;
    }
    let mut image = vec![0u16; 32768];
    let mut length = image.len() as u32;
    let (mut created, mut exited, mut kernel, mut user) = (
        FileTime::default(),
        FileTime::default(),
        FileTime::default(),
        FileTime::default(),
    );
    let valid = unsafe {
        QueryFullProcessImageNameW(process, 0, image.as_mut_ptr(), &mut length) != 0
            && GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) != 0
    };
    unsafe {
        CloseHandle(process);
    }
    if !valid
        || !String::from_utf16_lossy(&image[..length as usize])
            .rsplit('\\')
            .next()?
            .eq_ignore_ascii_case("chrome.exe")
    {
        return None;
    }
    Some((
        pid,
        (u64::from(created.high) << 32) | u64::from(created.low),
    ))
}
fn matches(key: PlayerKey) -> bool {
    let hwnd = key.handle as Handle;
    chrome_identity(hwnd) == Some((key.pid, key.started))
        && unsafe { GetPropW(hwnd, property().as_ptr()) } as usize == key.token
}
fn frame(hwnd: Handle) -> Option<Rect> {
    let mut r = WinRect::default();
    (unsafe { GetWindowRect(hwnd, &mut r) } != 0).then_some(Rect {
        x: f64::from(r.left),
        y: f64::from(r.top),
        width: f64::from(r.right - r.left),
        height: f64::from(r.bottom - r.top),
    })
}
fn next_token() -> usize {
    static NEXT: OnceLock<AtomicUsize> = OnceLock::new();
    NEXT.get_or_init(|| {
        AtomicUsize::new(
            (SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as usize
                ^ std::process::id() as usize)
                | 1,
        )
    })
    .fetch_add(1, Ordering::SeqCst)
    .max(1)
}
/// Serialize the property check/set/original-frame capture across app instances.
struct ClaimGuard(Handle);
impl ClaimGuard {
    fn acquire() -> Result<Self, String> {
        let name: Vec<u16> = "Local\\BDOBB.ChromePiP.Claim".encode_utf16().chain(Some(0)).collect();
        let handle = unsafe { CreateMutexW(ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() { return Err("Could not coordinate Chrome player ownership".into()); }
        match unsafe { WaitForSingleObject(handle, 0) } {
            0 | 0x80 => Ok(Self(handle)),
            _ => { unsafe { CloseHandle(handle); } Err("Another BDOBB app is checking Chrome’s player; try again".into()) }
        }
    }
}
impl Drop for ClaimGuard {
    fn drop(&mut self) { unsafe { ReleaseMutex(self.0); CloseHandle(self.0); } }
}
struct Win32;
impl Windows for Win32 {
    fn select(&mut self) -> Result<Option<Player>, String> {
        let _claim = ClaimGuard::acquire()?;
        unsafe extern "system" fn collect(hwnd: Handle, data: isize) -> i32 {
            // SAFETY: EnumWindows calls synchronously with our live Vec pointer.
            if let Some(identity) = eligible(hwnd).then(|| chrome_identity(hwnd)).flatten() {
                unsafe {
                    (&mut *(data as *mut Vec<(usize, u32, u64)>)).push((
                        hwnd as usize,
                        identity.0,
                        identity.1,
                    ));
                }
            }
            1
        }
        let mut found: Vec<(usize, u32, u64)> = Vec::new();
        if unsafe { EnumWindows(collect, &mut found as *mut _ as isize) } == 0 {
            return Err("Could not list Chrome's floating windows".into());
        }
        if found.len() > 1 {
            return Err(
                "More than one Chrome floating player is open; leave one open to grab it".into(),
            );
        }
        let Some((handle, pid, started)) = found.pop() else {
            return Ok(None);
        };
        let hwnd = handle as Handle;
        if !unsafe { GetPropW(hwnd, property().as_ptr()) }.is_null() {
            return Err("Chrome's player is already held by another BDOBB app; release it there or reopen the player".into());
        }
        let key = PlayerKey {
            handle,
            pid,
            started,
            token: next_token(),
        };
        // A window's properties disappear when it is destroyed. A replacement
        // reusing both HWND and PID therefore cannot inherit this generation.
        if unsafe { SetPropW(hwnd, property().as_ptr(), key.token as Handle) } == 0 {
            return Err(
                "Could not claim Chrome's player; run both apps with the same Windows permissions"
                    .into(),
            );
        }
        if !matches(key) {
            self.relinquish(key);
            return Ok(None);
        }
        match frame(hwnd) {
            Some(frame) => Ok(Some(Player { key, frame })),
            None => {
                self.relinquish(key);
                Ok(None)
            }
        }
    }
    fn frame(&self, key: PlayerKey) -> Option<Rect> {
        matches(key).then(|| frame(key.handle as Handle)).flatten()
    }
    fn place(&mut self, key: PlayerKey, r: Rect) -> Result<Rect, String> {
        let values = [r.x, r.y, r.width, r.height];
        if !values
            .iter()
            .all(|v| v.is_finite() && *v >= f64::from(i32::MIN) && *v <= f64::from(i32::MAX))
            || r.width <= 0.
            || r.height <= 0.
        {
            return Err("Invalid player geometry".into());
        }
        if !matches(key) {
            return Err("Chrome's floating player has closed or changed".into());
        }
        let hwnd = key.handle as Handle;
        if !eligible(hwnd) {
            return Err("Chrome’s player is temporarily unavailable; its original frame is retained".into());
        }
        if unsafe { IsHungAppWindow(hwnd) } != 0 {
            return Err("Chrome is not responding; try again in a moment".into());
        }
        // NOZORDER | NOACTIVATE | NOOWNERZORDER: preserve Chrome's topmost
        // status without stealing focus or changing another window's order.
        if unsafe {
            SetWindowPos(
                hwnd,
                ptr::null_mut(),
                r.x.round() as i32,
                r.y.round() as i32,
                r.width.round() as i32,
                r.height.round() as i32,
                0x0214,
            )
        } == 0
        {
            return Err("Windows could not move Chrome's player".into());
        }
        self.frame(key)
            .ok_or_else(|| "Chrome's floating player closed while moving".into())
    }
    fn displays(&self) -> Vec<Rect> {
        unsafe extern "system" fn collect(
            _: Handle,
            _: Handle,
            rect: *mut WinRect,
            data: isize,
        ) -> i32 {
            // SAFETY: EnumDisplayMonitors supplies a live RECT and our Vec is
            // exclusively borrowed until its synchronous callbacks finish.
            unsafe {
                let r = *rect;
                (&mut *(data as *mut Vec<Rect>)).push(Rect {
                    x: f64::from(r.left),
                    y: f64::from(r.top),
                    width: f64::from(r.right - r.left),
                    height: f64::from(r.bottom - r.top),
                });
            }
            1
        }
        let mut displays = vec![];
        unsafe {
            EnumDisplayMonitors(
                ptr::null_mut(),
                ptr::null(),
                collect,
                &mut displays as *mut _ as isize,
            );
        }
        displays
    }
    fn relinquish(&mut self, key: PlayerKey) {
        // Never remove a subsequent owner's property or a reused window's.
        if matches(key) {
            unsafe {
                RemovePropW(key.handle as Handle, property().as_ptr());
            }
        }
    }
}
struct State {
    grab: Grab<Win32>,
    last_css: Option<Rect>,
}
static STATE: OnceLock<Mutex<State>> = OnceLock::new();
static HOOK: Once = Once::new();
static QUITTING: AtomicBool = AtomicBool::new(false);
fn state<T>(f: impl FnOnce(&mut State) -> T) -> T {
    let mut guard = STATE
        .get_or_init(|| {
            Mutex::new(State {
                grab: Grab::new(Win32),
                last_css: None,
            })
        })
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    f(&mut guard)
}
fn geometry(hwnd: usize, css: Rect, player: Option<PlayerKey>) -> Option<(Rect, f64, bool)> {
    let hwnd = hwnd as Handle;
    let mut origin = Point::default();
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 || unsafe { ClientToScreen(hwnd, &mut origin) } == 0 {
        return None;
    }
    let scale = f64::from(dpi) / 96.;
    let front = unsafe { GetForegroundWindow() };
    let mut pid = 0;
    unsafe {
        GetWindowThreadProcessId(front, &mut pid);
    }
    let away = unsafe { IsIconic(hwnd) } != 0
        || (pid != std::process::id()
            && !player.is_some_and(|p| p.handle == front as usize && matches(p)));
    Some((
        Rect {
            x: f64::from(origin.x) + css.x * scale,
            y: f64::from(origin.y) + css.y * scale,
            width: css.width * scale,
            height: css.height * scale,
        },
        scale,
        away,
    ))
}
fn hook(window: &WebviewWindow, hwnd: usize) {
    HOOK.call_once(|| {
        window.on_window_event(|event| {
            if matches!(event, WindowEvent::Destroyed) {
                release_all()
            }
        });
        // No Tauri/main-thread method is called while the placement lock is
        // held. Re-read physical origin and DPI while following the window.
        std::thread::spawn(move || {
            while !QUITTING.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(500));
                state(|s| {
                    if !QUITTING.load(Ordering::SeqCst) {
                        if let Some(css) = s.last_css {
                            if let Some((area, scale, away)) =
                                geometry(hwnd, css, s.grab.player_key())
                            {
                                s.grab.sync(area, scale, away);
                            }
                        }
                    }
                });
            }
        });
    });
}
pub fn fit(window: &WebviewWindow, card: &str, css: Rect) -> Status {
    if window.label() != "main" {
        return Status::ViewerWindow;
    }
    let Ok(hwnd) = window.hwnd() else {
        return Status::Failed {
            reason: "BDOBB cannot read its own window".into(),
        };
    };
    let hwnd = hwnd.0 as usize;
    hook(window, hwnd);
    state(|s| {
        if QUITTING.load(Ordering::SeqCst) {
            return Status::Parked;
        }
        let Some((area, scale, away)) = geometry(hwnd, css, s.grab.player_key()) else {
            return Status::Failed {
                reason: "BDOBB cannot read its own window position".into(),
            };
        };
        let result = s.grab.fit(card, area, scale, away);
        if matches!(result, Status::Fitted | Status::Parked) {
            s.last_css = Some(css);
        }
        result
    })
}
pub fn park(window: &WebviewWindow, card: &str, menu: bool) -> Status {
    if window.label() != "main" {
        return Status::ViewerWindow;
    }
    state(|s| s.grab.park(card, menu))
}
pub fn release(window: &WebviewWindow, card: &str) {
    if window.label() == "main" {
        state(|s| s.grab.release(card));
    }
}
pub fn release_all() {
    QUITTING.store(true, Ordering::SeqCst);
    state(|s| s.grab.release_all());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn competing_app_claims_are_serialized() {
        let first = ClaimGuard::acquire().expect("first claim");
        assert!(std::thread::spawn(|| ClaimGuard::acquire().is_err()).join().unwrap());
        drop(first);
        assert!(ClaimGuard::acquire().is_ok());
    }
}
