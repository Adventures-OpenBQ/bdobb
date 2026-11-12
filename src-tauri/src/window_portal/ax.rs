// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

//! The Window Portal's macOS half: Chrome's floating player and its tab's
//! volume slider, reached through the Accessibility API (spec
//! docs/superpowers/specs/2026-11-12-window-portal-card-design.md).
//!
//! Hand-written declarations, not a bindings crate. No crate in Cargo.lock
//! binds ApplicationServices' AX calls, and naming core-foundation or
//! core-graphics as a dependency would add a line to Cargo.lock, which each
//! release line's dependency pack forbids. AppKit already links all three
//! frameworks; the #[link] attributes only say so.

use std::collections::VecDeque;
use std::ffi::{c_char, c_void, CStr};
use std::ptr;
use std::time::{Duration, Instant};

use super::logic::{parse_percent, Op, PlayerWindow, Rect, VolumeSlider};

const CHROME_BUNDLE_ID: &str = "com.google.Chrome";
/// The floating player's AX title in an English Chrome (spec, "Not verified": other languages).
const PLAYER_TITLE: &str = "Picture in Picture";
const SETTINGS_URL: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
/// Nodes visited looking for the slider before giving up.
/// ponytail: fixed cap; make it adaptive if a real page's slider lies deeper.
const SEARCH_LIMIT: usize = 20_000;
/// After a failed search (about 150 ms each), repeat its reason this long instead of searching again.
const SEARCH_COOLDOWN: Duration = Duration::from_secs(5);

type CFTypeRef = *const c_void;
const UTF8: u32 = 0x0800_0100; // kCFStringEncodingUTF8
const NUMBER_DOUBLE: isize = 13; // kCFNumberDoubleType
const AX_POINT: u32 = 1; // kAXValueTypeCGPoint
const AX_SIZE: u32 = 2; // kAXValueTypeCGSize
const AX_SUCCESS: i32 = 0;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[allow(non_upper_case_globals)]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    // Only their addresses are used; the type is a stand-in.
    static kCFTypeDictionaryKeyCallBacks: u8;
    static kCFTypeDictionaryValueCallBacks: u8;
    static kCFBooleanTrue: CFTypeRef;
    fn CFRelease(cf: CFTypeRef);
    fn CFRetain(cf: CFTypeRef) -> CFTypeRef;
    fn CFGetTypeID(cf: CFTypeRef) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFNumberGetTypeID() -> usize;
    fn CFArrayGetTypeID() -> usize;
    fn CFArrayGetCount(array: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFTypeRef, index: isize) -> CFTypeRef;
    fn CFStringCreateWithBytes(alloc: CFTypeRef, bytes: *const u8, len: isize, encoding: u32, external: u8) -> CFTypeRef;
    fn CFStringGetCString(string: CFTypeRef, buffer: *mut c_char, size: isize, encoding: u32) -> u8;
    fn CFNumberGetValue(number: CFTypeRef, kind: isize, out: *mut c_void) -> u8;
    fn CFDictionaryCreate(
        alloc: CFTypeRef,
        keys: *const CFTypeRef,
        values: *const CFTypeRef,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CFTypeRef;
}

#[allow(non_upper_case_globals)]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    static kAXTrustedCheckOptionPrompt: CFTypeRef;
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> u8;
    fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
    fn AXUIElementCopyAttributeValue(element: CFTypeRef, attribute: CFTypeRef, value: *mut CFTypeRef) -> i32;
    fn AXUIElementSetAttributeValue(element: CFTypeRef, attribute: CFTypeRef, value: CFTypeRef) -> i32;
    fn AXUIElementPerformAction(element: CFTypeRef, action: CFTypeRef) -> i32;
    fn AXValueCreate(kind: u32, value: *const c_void) -> CFTypeRef;
    fn AXValueGetValue(value: CFTypeRef, kind: u32, out: *mut c_void) -> u8;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> CGRect;
    fn CGMainDisplayID() -> u32;
}

/// An owned (+1) CoreFoundation reference, released on drop.
struct Cf(CFTypeRef);

impl Cf {
    fn new(raw: CFTypeRef) -> Option<Cf> {
        // `then`, never `then_some`: an eagerly built Cf(null) would be
        // dropped, and CFRelease(NULL) crashes.
        (!raw.is_null()).then(|| Cf(raw))
    }
}

impl Drop for Cf {
    fn drop(&mut self) {
        // SAFETY: Cf only ever holds a non-null reference it owns.
        unsafe { CFRelease(self.0) }
    }
}

// SAFETY: CF retain and release are thread-safe, and every AX call made
// through a Cf happens behind the controller's mutex (mod.rs).
unsafe impl Send for Cf {}

fn cfstr(text: &str) -> Option<Cf> {
    // SAFETY: the bytes are valid UTF-8 for their length; CF copies them.
    Cf::new(unsafe { CFStringCreateWithBytes(ptr::null(), text.as_ptr(), text.len() as isize, UTF8, 0) })
}

fn attr(element: CFTypeRef, name: &str) -> Option<Cf> {
    let name = cfstr(name)?;
    let mut out: CFTypeRef = ptr::null();
    // SAFETY: element is a live AXUIElement; out receives a +1 reference on success.
    let error = unsafe { AXUIElementCopyAttributeValue(element, name.0, &mut out) };
    if error == AX_SUCCESS { Cf::new(out) } else { None }
}

fn set(element: CFTypeRef, name: &str, value: &Cf) -> Result<(), String> {
    let key = cfstr(name).ok_or("cannot build an AX attribute name")?;
    // SAFETY: live element, CFString key, AXValue value.
    match unsafe { AXUIElementSetAttributeValue(element, key.0, value.0) } {
        AX_SUCCESS => Ok(()),
        error => Err(format!("Accessibility refused {name} (error {error})")),
    }
}

fn string(cf: CFTypeRef) -> Option<String> {
    // SAFETY: type-checked before reading; the buffer is NUL-terminated by CF on success.
    unsafe {
        if CFGetTypeID(cf) != CFStringGetTypeID() {
            return None;
        }
        let mut buffer = vec![0u8; 4096];
        (CFStringGetCString(cf, buffer.as_mut_ptr().cast(), buffer.len() as isize, UTF8) != 0)
            .then(|| CStr::from_ptr(buffer.as_ptr().cast()).to_string_lossy().into_owned())
    }
}

fn number(cf: CFTypeRef) -> Option<f64> {
    // SAFETY: type-checked before reading into an f64.
    unsafe {
        if CFGetTypeID(cf) != CFNumberGetTypeID() {
            return None;
        }
        let mut value = 0f64;
        (CFNumberGetValue(cf, NUMBER_DOUBLE, (&mut value as *mut f64).cast()) != 0).then_some(value)
    }
}

fn string_attr(element: CFTypeRef, name: &str) -> Option<String> {
    attr(element, name).and_then(|value| string(value.0))
}

/// An array attribute's elements, each retained.
fn elements(element: CFTypeRef, name: &str) -> Vec<Cf> {
    let Some(array) = attr(element, name) else { return Vec::new() };
    // SAFETY: type-checked; each value is retained before it is wrapped.
    unsafe {
        if CFGetTypeID(array.0) != CFArrayGetTypeID() {
            return Vec::new();
        }
        (0..CFArrayGetCount(array.0))
            .filter_map(|i| Cf::new(CFRetain(CFArrayGetValueAtIndex(array.0, i))))
            .collect()
    }
}

fn value<T: Default>(element: CFTypeRef, name: &str, kind: u32) -> Option<T> {
    let raw = attr(element, name)?;
    let mut out = T::default();
    // SAFETY: kind matches T (AX_POINT for CGPoint, AX_SIZE for CGSize).
    let ok = unsafe { AXValueGetValue(raw.0, kind, (&mut out as *mut T).cast()) } != 0;
    ok.then_some(out)
}

fn ax_value<T>(kind: u32, value: &T) -> Option<Cf> {
    // SAFETY: kind matches T; AX copies the value.
    Cf::new(unsafe { AXValueCreate(kind, (value as *const T).cast()) })
}

fn chrome_pid() -> Option<i32> {
    use objc2::{class, msg_send, rc::autoreleasepool, runtime::AnyObject};
    use objc2_foundation::NSString;
    autoreleasepool(|_| {
        let bundle = NSString::from_str(CHROME_BUNDLE_ID);
        // SAFETY: AppKit's NSRunningApplication class method and getters, with their declared types.
        unsafe {
            let apps: *mut AnyObject =
                msg_send![class!(NSRunningApplication), runningApplicationsWithBundleIdentifier: &*bundle];
            if apps.is_null() {
                return None;
            }
            let first: *mut AnyObject = msg_send![apps, firstObject];
            if first.is_null() {
                return None;
            }
            let pid: i32 = msg_send![first, processIdentifier];
            Some(pid)
        }
    })
}

fn chrome() -> Option<Cf> {
    let pid = chrome_pid()?;
    // SAFETY: returns a +1 AXUIElement for the pid.
    Cf::new(unsafe { AXUIElementCreateApplication(pid) })
}

/// Registers BDOBB in the Accessibility list (the system prompt) and opens
/// the pane, so the user can switch it on.
pub fn ask_for_permission() {
    // SAFETY: a one-entry CFDictionary of CF constants, released when `options` drops.
    unsafe {
        let keys = [kAXTrustedCheckOptionPrompt];
        let values = [kCFBooleanTrue];
        let options = Cf::new(CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            ptr::addr_of!(kCFTypeDictionaryKeyCallBacks).cast(),
            ptr::addr_of!(kCFTypeDictionaryValueCallBacks).cast(),
        ));
        if let Some(options) = options {
            let _ = AXIsProcessTrustedWithOptions(options.0);
        }
    }
    if let Err(error) = std::process::Command::new("/usr/bin/open").arg(SETTINGS_URL).status() {
        eprintln!("window portal: cannot open System Settings: {error}");
    }
}

/// Chrome's `Picture in Picture` window, cached while it answers.
#[derive(Default)]
pub struct AxWindow {
    player: Option<Cf>,
}

impl AxWindow {
    fn player(&mut self) -> Option<CFTypeRef> {
        let alive = self.player.as_ref().is_some_and(|p| attr(p.0, "AXPosition").is_some());
        if !alive {
            self.player = chrome().and_then(|app| {
                elements(app.0, "AXWindows")
                    .into_iter()
                    .find(|w| string_attr(w.0, "AXTitle").as_deref() == Some(PLAYER_TITLE))
            });
        }
        self.player.as_ref().map(|p| p.0)
    }
}

impl PlayerWindow for AxWindow {
    fn trusted(&self) -> bool {
        // SAFETY: no arguments.
        unsafe { AXIsProcessTrusted() != 0 }
    }

    fn frame(&mut self) -> Result<Option<Rect>, String> {
        let Some(player) = self.player() else { return Ok(None) };
        let position: CGPoint = value(player, "AXPosition", AX_POINT).ok_or("cannot read the player's position")?;
        let size: CGSize = value(player, "AXSize", AX_SIZE).ok_or("cannot read the player's size")?;
        Ok(Some(Rect { x: position.x, y: position.y, width: size.width, height: size.height }))
    }

    fn apply(&mut self, op: Op) -> Result<(), String> {
        let player = self.player().ok_or("the floating player closed")?;
        let (name, raw) = match op {
            Op::Move(x, y) => ("AXPosition", ax_value(AX_POINT, &CGPoint { x, y })),
            Op::Size(width, height) => ("AXSize", ax_value(AX_SIZE, &CGSize { width, height })),
        };
        set(player, name, &raw.ok_or("cannot build an AX value")?)
    }

    fn display_bounds(&self, rect: Rect) -> Rect {
        let (cx, cy) = (rect.x + rect.width / 2.0, rect.y + rect.height / 2.0);
        let mut ids = [0u32; 16];
        let mut count = 0u32;
        // SAFETY: CoreGraphics writes at most 16 ids and reports how many.
        let bounds = unsafe {
            let listed: &[u32] =
                if CGGetActiveDisplayList(16, ids.as_mut_ptr(), &mut count) == 0 { &ids[..count as usize] } else { &[] };
            listed
                .iter()
                .map(|&id| CGDisplayBounds(id))
                .find(|b| cx >= b.origin.x && cx < b.origin.x + b.size.width && cy >= b.origin.y && cy < b.origin.y + b.size.height)
                .unwrap_or_else(|| CGDisplayBounds(CGMainDisplayID()))
        };
        Rect { x: bounds.origin.x, y: bounds.origin.y, width: bounds.size.width, height: bounds.size.height }
    }
}

/// The source tab's volume slider, cached while it answers. Chrome exposes
/// only the selected tab's page (spec, probe).
#[derive(Default)]
pub struct AxSlider {
    cached: Option<(String, String, Cf)>,
    missed: Option<(Instant, String)>,
}

impl AxSlider {
    fn element(&mut self, source: &str, label: &str) -> Result<CFTypeRef, String> {
        if let Some((s, l, slider)) = &self.cached {
            if s == source && l == label && attr(slider.0, "AXValue").is_some() {
                return Ok(slider.0);
            }
        }
        self.cached = None;
        if let Some((at, reason)) = &self.missed {
            if at.elapsed() < SEARCH_COOLDOWN {
                return Err(reason.clone());
            }
        }
        match find_slider(source, label) {
            Ok(slider) => {
                let raw = slider.0;
                self.cached = Some((source.to_owned(), label.to_owned(), slider));
                self.missed = None;
                Ok(raw)
            }
            Err(reason) => {
                self.missed = Some((Instant::now(), reason.clone()));
                Err(reason)
            }
        }
    }
}

/// Breadth-first through the Chrome window whose title contains `source`,
/// for an AXSlider named `label`. The probe saw the name as its title;
/// Chrome usually maps a page's aria-label to AXDescription, so both are
/// accepted.
fn find_slider(source: &str, label: &str) -> Result<Cf, String> {
    let app = chrome().ok_or("Chrome is not running")?;
    let window = elements(app.0, "AXWindows")
        .into_iter()
        .find(|w| string_attr(w.0, "AXTitle").is_some_and(|t| t.contains(source)))
        .ok_or_else(|| format!("No Chrome window shows a tab whose title contains \u{201c}{source}\u{201d}. Select the stream's tab in its window."))?;
    let mut queue = VecDeque::from([window]);
    let mut visited = 0;
    while let Some(element) = queue.pop_front() {
        visited += 1;
        if visited > SEARCH_LIMIT {
            break;
        }
        let named = || {
            string_attr(element.0, "AXTitle").as_deref() == Some(label)
                || string_attr(element.0, "AXDescription").as_deref() == Some(label)
        };
        if string_attr(element.0, "AXRole").as_deref() == Some("AXSlider") && named() {
            return Ok(element);
        }
        queue.extend(elements(element.0, "AXChildren"));
    }
    Err(format!(
        "No \u{201c}{label}\u{201d} slider in that tab. The stream's tab must be the selected tab, and the site may have renamed the control."
    ))
}

impl VolumeSlider for AxSlider {
    fn level(&mut self, source: &str, label: &str) -> Result<u8, String> {
        let slider = self.element(source, label)?;
        let raw = attr(slider, "AXValue").ok_or("the volume slider has no value")?;
        number(raw.0)
            .map(|n| n.round().clamp(0.0, 100.0) as u8)
            .or_else(|| string(raw.0).and_then(|s| parse_percent(&s)))
            .ok_or_else(|| "the volume slider's value is not a percentage".to_string())
    }

    fn step(&mut self, source: &str, label: &str, up: bool, count: u32) -> Result<(), String> {
        let slider = self.element(source, label)?;
        let action = cfstr(if up { "AXIncrement" } else { "AXDecrement" }).ok_or("cannot build an AX action name")?;
        for _ in 0..count {
            // SAFETY: live slider element and CFString action name.
            let error = unsafe { AXUIElementPerformAction(slider, action.0) };
            if error != AX_SUCCESS {
                return Err(format!("the volume slider refused a step (error {error})"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Run by hand on a Mac with Chrome's floating player open and
    /// Accessibility granted to the terminal running cargo (Task 8):
    /// cargo test --locked window_portal::ax -- --ignored --nocapture
    #[test]
    #[ignore = "needs the real Chrome floating player and Accessibility permission"]
    fn reads_the_real_player_and_slider() {
        let mut window = AxWindow::default();
        assert!(window.trusted(), "grant Accessibility to this terminal first");
        let frame = window.frame().expect("AX read").expect("no Picture in Picture window");
        println!("player {frame:?} on display {:?}", window.display_bounds(frame));
        let mut slider = AxSlider::default();
        println!("CNBC volume: {:?}", slider.level("CNBC", "Volume Level"));
    }
}
