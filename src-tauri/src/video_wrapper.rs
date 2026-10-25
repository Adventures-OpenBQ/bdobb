// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

//! The YouTube card's local loopback wrapper (spec:
//! docs/superpowers/specs/2026-10-01-youtube-loopback-wrapper-design.md).
//!
//! YouTube refuses an embed that carries no usable Referer ("Error 153"), and
//! the app's pages come from tauri://localhost, so a youtube.com/embed frame
//! placed directly in a card never plays on the desktop. This serves one fixed
//! page on http://127.0.0.1:<port>/yt?id=<id> that embeds the same video; the
//! card frames THAT page, and YouTube sees the loopback origin as the Referer.
//!
//! Standard library only, deliberately: one route, one fixed template, no
//! state. The listener binds 127.0.0.1 (never 0.0.0.0) on an OS-assigned port,
//! answers only when Host is exactly 127.0.0.1:<port> (which defeats DNS
//! rebinding), and handles one connection at a time with a 2-second deadline
//! and a 2 KiB cap on the request head. The id is validated here as well as in
//! src/lib/youtube.ts, so nothing but an 11-character video id ever reaches
//! the template.
//!
//! The page deliberately sets no `frame-ancestors`: WebKit's matching of the
//! tauri: scheme there is unproven, and the worst case without it is another
//! local page embedding a public YouTube video through this one.

use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

/// The request head (request line + headers) may not exceed this.
const MAX_HEAD: usize = 2048;
/// Total time a connection gets to deliver its head -- a deadline, not a
/// per-read timeout, so a client trickling one byte at a time cannot hold the
/// single serving thread for longer than this.
const READ_DEADLINE: Duration = Duration::from_secs(2);

const CSP: &str = "default-src 'none'; frame-src https://www.youtube.com; style-src 'unsafe-inline'";
/// The same `allow` list YouTubeRenderer gives its own frame.
const ALLOW: &str = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

/// A running listener: its bound address, and whether its accept loop is
/// still alive (the loop clears the flag on the way out).
struct Wrapper {
    addr: SocketAddr,
    alive: Arc<AtomicBool>,
}

static WRAPPER: Mutex<Option<Wrapper>> = Mutex::new(None);
static BIND_FAILURE_LOGGED: AtomicBool = AtomicBool::new(false);

/// The port the wrapper listens on, binding it on first use. Later calls
/// return the same port while the accept loop is alive; once it has exited
/// (an iOS suspension can close the socket) the next call binds again, on a
/// new port. None when the bind fails -- the card then frames youtube.com
/// directly, exactly as before this existed.
#[tauri::command]
pub fn video_wrapper_port() -> Option<u16> {
    port_in(&WRAPPER)
}

/// video_wrapper_port's body, over a slot the tests can own.
fn port_in(slot: &Mutex<Option<Wrapper>>) -> Option<u16> {
    let mut slot = slot.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(w) = slot.as_ref().filter(|w| w.alive.load(Ordering::SeqCst)) {
        return Some(w.addr.port());
    }
    match start() {
        Ok(w) => {
            let port = w.addr.port();
            *slot = Some(w);
            Some(port)
        }
        Err(e) => {
            if !BIND_FAILURE_LOGGED.swap(true, Ordering::SeqCst) {
                eprintln!("video wrapper: cannot listen on 127.0.0.1: {e}");
            }
            None
        }
    }
}

fn start() -> io::Result<Wrapper> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let addr = listener.local_addr()?;
    let alive = Arc::new(AtomicBool::new(true));
    let flag = Arc::clone(&alive);
    thread::Builder::new()
        .name("video-wrapper".into())
        .spawn(move || {
            // ponytail: one connection at a time; a slow client delays the
            // next by at most READ_DEADLINE. Fine for one card's page load.
            for conn in listener.incoming() {
                match conn {
                    Ok(stream) => handle(stream, addr.port()),
                    // ponytail: any accept error ends the loop; the next
                    // card mount re-binds on a new port.
                    Err(_) => break,
                }
            }
            flag.store(false, Ordering::SeqCst);
        })?;
    Ok(Wrapper { addr, alive })
}

fn handle(mut stream: TcpStream, port: u16) {
    let _ = stream.set_write_timeout(Some(READ_DEADLINE));
    // No complete head within the cap or the deadline: close, no answer.
    let Some(head) = read_head(&mut stream) else { return };
    let (code, body) = respond(&head, port);
    let _ = stream.write_all(response(code, &body).as_bytes());
}

/// Reads up to the blank line ending the head; None past MAX_HEAD bytes, past
/// READ_DEADLINE, on EOF, or on non-UTF-8.
fn read_head(stream: &mut TcpStream) -> Option<String> {
    let deadline = Instant::now() + READ_DEADLINE;
    let mut buf = Vec::with_capacity(512);
    let mut chunk = [0u8; 512];
    while buf.len() < MAX_HEAD {
        let left = deadline.checked_duration_since(Instant::now()).filter(|d| !d.is_zero())?;
        stream.set_read_timeout(Some(left)).ok()?;
        let take = (MAX_HEAD - buf.len()).min(chunk.len());
        let n = stream.read(&mut chunk[..take]).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            buf.truncate(end);
            return String::from_utf8(buf).ok();
        }
    }
    None
}

/// The whole routing decision, as (status, body), for a request head without
/// its terminating blank line. Pure, so the tests need no socket.
fn respond(head: &str, port: u16) -> (u16, String) {
    let mut lines = head.split("\r\n");
    let mut request = lines.next().unwrap_or("").split(' ');
    let (method, target, version) = (request.next(), request.next(), request.next());
    if request.next().is_some() || !version.is_some_and(|v| v.starts_with("HTTP/1.")) {
        return error(400);
    }
    // Exactly one Host header, exactly 127.0.0.1:<port>. Anything else --
    // a rebinding attacker's name, `localhost`, no port, two Host headers --
    // is refused before the method or path is even looked at.
    let expected = format!("127.0.0.1:{port}");
    let hosts: Vec<&str> = lines
        .filter_map(|l| l.split_once(':'))
        .filter(|(k, _)| k.trim().eq_ignore_ascii_case("host"))
        .map(|(_, v)| v.trim())
        .collect();
    if hosts != [expected.as_str()] {
        return error(421);
    }
    if method != Some("GET") {
        return error(405);
    }
    let target = target.unwrap_or("");
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/yt" {
        return error(404);
    }
    // The query must be exactly `id=<id>`: the id alphabet has no `&`, `=` or
    // `%`, so an extra parameter or any encoding fails validation.
    match query.strip_prefix("id=").filter(|id| valid_id(id)) {
        Some(id) => (200, page(id)),
        None => error(400),
    }
}

/// `^[A-Za-z0-9_-]{11}$`, the same rule as src/lib/youtube.ts's ID_RE.
fn valid_id(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The fixed template. Its only variable is an id that passed valid_id.
fn page(id: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>YouTube video</title>\
<style>html,body{{margin:0;height:100%;background:#000}}iframe{{display:block;border:0;width:100%;height:100%}}</style>\
</head><body><iframe src=\"https://www.youtube.com/embed/{id}\" allow=\"{ALLOW}\" allowfullscreen></iframe></body></html>"
    )
}

fn error(code: u16) -> (u16, String) {
    (code, format!("{}\n", reason(code)))
}

fn reason(code: u16) -> &'static str {
    match code {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Misdirected Request",
    }
}

/// The full HTTP/1.1 response. Every status carries the same headers; a 405
/// also names the one allowed method.
fn response(code: u16, body: &str) -> String {
    let allow = if code == 405 { "Allow: GET\r\n" } else { "" };
    format!(
        "HTTP/1.1 {code} {}\r\n\
Content-Type: text/html; charset=utf-8\r\n\
Content-Length: {}\r\n\
Referrer-Policy: strict-origin-when-cross-origin\r\n\
Cache-Control: no-cache\r\n\
X-Content-Type-Options: nosniff\r\n\
Content-Security-Policy: {CSP}\r\n\
{allow}Connection: close\r\n\r\n{body}",
        reason(code),
        body.len()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "uYyhswnZkSw";
    const PORT: u16 = 41234;

    fn req(line: &str) -> String {
        format!("{line}\r\nHost: 127.0.0.1:{PORT}")
    }

    #[test]
    fn valid_id_gets_the_page_embedding_exactly_that_id() {
        let (code, body) = respond(&req(&format!("GET /yt?id={ID} HTTP/1.1")), PORT);
        assert_eq!(code, 200);
        let embed = format!("src=\"https://www.youtube.com/embed/{ID}\"");
        assert_eq!(body.matches(&embed).count(), 1);
        assert_eq!(body.matches("<iframe").count(), 1);
        assert!(body.contains(ALLOW));
    }

    #[test]
    fn bad_or_missing_id_is_400() {
        for target in [
            "/yt",
            "/yt?id=",
            "/yt?id=tooShort",
            "/yt?id=uYyhswnZkSwX",
            "/yt?id=uYyhswnZk%53w",
            "/yt?id=uYyhs<nZkSw",
            &format!("/yt?id={ID}&autoplay=1"),
            &format!("/yt?v={ID}"),
        ] {
            let (code, _) = respond(&req(&format!("GET {target} HTTP/1.1")), PORT);
            assert_eq!(code, 400, "{target}");
        }
    }

    #[test]
    fn other_path_is_404() {
        for target in ["/", "/yt/", "/favicon.ico", &format!("/embed/{ID}")] {
            assert_eq!(respond(&req(&format!("GET {target} HTTP/1.1")), PORT).0, 404, "{target}");
        }
    }

    #[test]
    fn other_method_is_405_and_names_get() {
        for method in ["POST", "HEAD", "PUT", "OPTIONS", "get"] {
            assert_eq!(respond(&req(&format!("{method} /yt?id={ID} HTTP/1.1")), PORT).0, 405, "{method}");
        }
        assert!(response(405, "x").contains("\r\nAllow: GET\r\n"));
    }

    #[test]
    fn any_host_but_exactly_loopback_and_port_is_421() {
        let line = format!("GET /yt?id={ID} HTTP/1.1");
        for host in [
            "Host: localhost:41234".to_string(),
            "Host: 127.0.0.1".to_string(),
            "Host: 127.0.0.1:1".to_string(),
            "Host: evil.example:41234".to_string(),
            format!("Host: 127.0.0.1:{PORT}\r\nHost: evil.example"),
            String::new(),
        ] {
            assert_eq!(respond(&format!("{line}\r\n{host}"), PORT).0, 421, "{host:?}");
        }
        // The header NAME is case-insensitive, as HTTP says.
        assert_eq!(respond(&format!("{line}\r\nhOsT: 127.0.0.1:{PORT}"), PORT).0, 200);
    }

    #[test]
    fn malformed_request_line_is_400() {
        for line in ["", "GET", &format!("GET /yt?id={ID}"), &format!("GET /yt?id={ID} SPDY/3"), &format!("GET /yt?id={ID} HTTP/1.1 extra")] {
            assert_eq!(respond(&format!("{line}\r\nHost: 127.0.0.1:{PORT}"), PORT).0, 400, "{line:?}");
        }
    }

    #[test]
    fn every_response_carries_the_spec_headers() {
        let r = response(200, "body");
        for h in [
            "HTTP/1.1 200 OK\r\n",
            "\r\nContent-Type: text/html; charset=utf-8\r\n",
            "\r\nContent-Length: 4\r\n",
            "\r\nReferrer-Policy: strict-origin-when-cross-origin\r\n",
            "\r\nCache-Control: no-cache\r\n",
            "\r\nX-Content-Type-Options: nosniff\r\n",
            "\r\nContent-Security-Policy: default-src 'none'; frame-src https://www.youtube.com; style-src 'unsafe-inline'\r\n",
        ] {
            assert!(r.contains(h), "{h:?}");
        }
        assert!(!r.contains("frame-ancestors"));
        assert!(r.ends_with("\r\n\r\nbody"));
    }

    /// Sends `raw` to a live listener and returns everything it answers.
    fn exchange(port: u16, raw: &str) -> String {
        let mut s = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        s.write_all(raw.as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn binds_loopback_only_and_serves_over_a_real_socket() {
        let w = start().unwrap();
        assert_eq!(w.addr.ip(), Ipv4Addr::LOCALHOST);
        let port = w.addr.port();
        let ok = exchange(port, &format!("GET /yt?id={ID} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"));
        assert!(ok.starts_with("HTTP/1.1 200 OK\r\n"), "{ok}");
        assert!(ok.contains(&format!("https://www.youtube.com/embed/{ID}")));
        let refused = exchange(port, &format!("GET /yt?id={ID} HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n"));
        assert!(refused.starts_with("HTTP/1.1 421 "), "{refused}");
    }

    #[test]
    fn an_oversized_head_is_dropped_and_the_next_client_is_served() {
        let w = start().unwrap();
        let port = w.addr.port();
        // The junk is a COMPLETE head (it ends in the blank line) with no Host
        // header, 3 KiB long. Without the MAX_HEAD cap the server would read
        // it all and answer 421, so the client would see bytes and the
        // is_empty assert below would fail; with the cap it drops the
        // connection at 2048 bytes, before it ever sees the blank line.
        let junk = format!("GET /yt?id={ID} HTTP/1.1\r\nX-Pad: {}\r\n\r\n", "a".repeat(3 * 1024));
        // The server closes with unread bytes pending, so the client may see
        // a reset rather than a clean EOF; either way it gets no answer.
        let mut s = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        let _ = s.write_all(junk.as_bytes());
        let mut out = Vec::new();
        let _ = s.read_to_end(&mut out);
        assert!(out.is_empty());
        let ok = exchange(port, &format!("GET /yt?id={ID} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"));
        assert!(ok.starts_with("HTTP/1.1 200 OK\r\n"), "{ok}");
    }

    #[test]
    fn a_silent_client_is_cut_off_at_the_deadline() {
        let w = start().unwrap();
        let port = w.addr.port();
        let started = Instant::now();
        let mut idle = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        let mut out = String::new();
        idle.read_to_string(&mut out).unwrap();
        assert_eq!(out, "");
        assert!(started.elapsed() < READ_DEADLINE + Duration::from_secs(1));
        let ok = exchange(port, &format!("GET /yt?id={ID} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"));
        assert!(ok.starts_with("HTTP/1.1 200 OK\r\n"), "{ok}");
    }

    #[test]
    fn the_port_is_stable_while_alive_and_rebinds_after_the_loop_ends() {
        let slot = Mutex::new(None);
        let first = port_in(&slot).unwrap();
        assert_eq!(port_in(&slot), Some(first));
        // What the accept loop does on its way out. A real accept error cannot
        // be provoked portably, so the test sets the flag the loop would set.
        slot.lock().unwrap().as_ref().unwrap().alive.store(false, Ordering::SeqCst);
        let second = port_in(&slot).unwrap();
        assert_ne!(second, first);
        let ok = exchange(second, &format!("GET /yt?id={ID} HTTP/1.1\r\nHost: 127.0.0.1:{second}\r\n\r\n"));
        assert!(ok.starts_with("HTTP/1.1 200 OK\r\n"), "{ok}");
    }
}
