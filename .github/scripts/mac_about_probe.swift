import Foundation
import ApplicationServices
import CryptoKit
import Darwin

@_silgen_name("proc_pidpath")
private func nativeProcPidPath(_ pid: Int32, _ buffer: UnsafeMutableRawPointer, _ size: UInt32) -> Int32

private var targetPID: pid_t = 0
private var deadline = 0.0
private var nodesVisited = 0
private var trusted = false
private var menuInvoked = false
private let maximumNodes = 256

private enum ProbeFailure: Error {
    case timeout, budget, owner, unavailable
}

private func emit(_ status: String, name: String? = nil, version: String? = nil, focused: Bool = false) -> Never {
    var value: [String: Any] = ["status": status, "origin": "AX_OWNED_ABOUT_STATIC_TEXT",
        "ax_trusted": trusted, "menu_invoked": menuInvoked, "owned_window_focused": focused,
        "nodes_visited": nodesVisited]
    if let name { value["name_text"] = name }
    if let version { value["version_text"] = version }
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    }
    exit(status.hasPrefix("ERROR_") ? 2 : 0)
}

private func processPath(_ pid: pid_t) -> String? {
    var buffer = [UInt8](repeating: 0, count: 4096)
    let count = buffer.withUnsafeMutableBytes { nativeProcPidPath(pid, $0.baseAddress!, UInt32($0.count)) }
    guard count > 0, let zero = buffer.firstIndex(of: 0),
          let path = String(bytes: buffer[..<zero], encoding: .utf8) else { return nil }
    return URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL.path
}

private func budget() throws {
    if ProcessInfo.processInfo.systemUptime >= deadline { throw ProbeFailure.timeout }
    if nodesVisited > maximumNodes { throw ProbeFailure.budget }
}

private func prepare(_ element: AXUIElement) throws {
    try budget()
    var pid: pid_t = 0
    guard AXUIElementGetPid(element, &pid) == .success, pid == targetPID else { throw ProbeFailure.owner }
    guard AXUIElementSetMessagingTimeout(element, 0.12) == .success else { throw ProbeFailure.unavailable }
}

private func attribute(_ element: AXUIElement, _ name: String) throws -> CFTypeRef? {
    try prepare(element)
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

private func string(_ element: AXUIElement, _ name: String) throws -> String? {
    return try attribute(element, name) as? String
}

private func boolean(_ element: AXUIElement, _ name: String) throws -> Bool? {
    return try attribute(element, name) as? Bool
}

private func elementAttribute(_ element: AXUIElement, _ name: String) throws -> AXUIElement? {
    guard let value = try attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(value, to: AXUIElement.self)
}

private func children(_ element: AXUIElement, _ name: String = kAXChildrenAttribute, limit: Int = 32) throws -> [AXUIElement] {
    try prepare(element)
    var values: CFArray?
    guard AXUIElementCopyAttributeValues(element, name as CFString, 0, limit + 1, &values) == .success,
          let values else { return [] }
    if CFArrayGetCount(values) > limit { throw ProbeFailure.budget }
    var result: [AXUIElement] = []
    for index in 0..<CFArrayGetCount(values) {
        let object = unsafeBitCast(CFArrayGetValueAtIndex(values, index), to: AnyObject.self)
        guard CFGetTypeID(object) == AXUIElementGetTypeID() else { throw ProbeFailure.unavailable }
        let child = unsafeBitCast(object, to: AXUIElement.self)
        try prepare(child)
        result.append(child)
    }
    return result
}

private func walk(_ root: AXUIElement, visitor: (AXUIElement) throws -> Bool) throws -> AXUIElement? {
    var queue = [root]
    var seen: [AXUIElement] = []
    var index = 0
    while index < queue.count {
        try budget()
        let node = queue[index]
        index += 1
        if seen.contains(where: { CFEqual($0, node) }) { continue }
        seen.append(node)
        nodesVisited += 1
        try prepare(node)
        if try visitor(node) { return node }
        queue.append(contentsOf: try children(node))
        if queue.count > maximumNodes { throw ProbeFailure.budget }
    }
    return nil
}

private func aboutTexts(_ window: AXUIElement) throws -> (Set<String>, Set<String>) {
    var names = Set<String>()
    var versions = Set<String>()
    _ = try walk(window) { node in
        if try string(node, kAXRoleAttribute) == kAXStaticTextRole {
            let candidates = [try string(node, kAXValueAttribute), try string(node, kAXTitleAttribute)]
            for candidate in candidates.compactMap({ $0 }) where candidate.utf8.count <= 128 {
                let text = candidate.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
                if text == "BDOBB" { names.insert(text) }
                if text.range(of: #"^Version [0-9]+(?:\.[0-9]+){1,3} \([0-9]+(?:\.[0-9]+){1,3}\)$"#, options: .regularExpression) != nil {
                    versions.insert(text)
                }
            }
        }
        return false
    }
    return (names, versions)
}

// Activation and menu population are asynchronous; share the original deadline/node budget.
private func pollOwned(_ executable: String, condition: () throws -> Bool) throws -> Bool {
    while ProcessInfo.processInfo.systemUptime < deadline {
        guard processPath(targetPID) == executable else { emit("ERROR_PID_PATH_MISMATCH") }
        try budget()
        if try condition() { return true }
        let remaining = deadline - ProcessInfo.processInfo.systemUptime
        if remaining > 0 { Thread.sleep(forTimeInterval: min(0.12, remaining)) }
    }
    return false
}

private func main() {
    let environment = ProcessInfo.processInfo.environment
    guard environment["GITHUB_ACTIONS"] == "true", environment["RUNNER_ENVIRONMENT"] == "github-hosted",
          environment["RUNNER_OS"] == "macOS" else { emit("ERROR_HOST_GUARD") }
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard arguments.count == 6, arguments[0] == "--pid", arguments[2] == "--executable", arguments[4] == "--sha256",
          let pid = Int32(arguments[1]), pid > 0,
          arguments[5].range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil else { emit("ERROR_ARGUMENTS") }
    targetPID = pid
    // Read state only. No WithOptions(prompt), trust grant, TCC or Automation API.
    trusted = AXIsProcessTrusted()
    if !trusted { emit("GAP_AX_NOT_TRUSTED") }
    let executable = URL(fileURLWithPath: arguments[3]).resolvingSymlinksInPath().standardizedFileURL.path
    guard processPath(pid) == executable else { emit("ERROR_PID_PATH_MISMATCH") }
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: executable)),
          SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == arguments[5] else { emit("ERROR_EXECUTABLE_SHA_MISMATCH") }
    deadline = ProcessInfo.processInfo.systemUptime + 10.0
    do {
        let app = AXUIElementCreateApplication(pid)
        try prepare(app)
        let before = try children(app, kAXWindowsAttribute, limit: 16)
        guard let menuBar = try elementAttribute(app, kAXMenuBarAttribute) else { emit("GAP_APP_AX_UNAVAILABLE") }
        let menus = try children(menuBar, limit: 16)
        var appMenu: AXUIElement?
        for menu in menus {
            nodesVisited += 1
            if try string(menu, kAXTitleAttribute) == "BDOBB" { appMenu = menu; break }
        }
        guard let appMenu else { emit("GAP_APP_MENU_NOT_FOUND") }
        try prepare(app)
        guard AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue) == .success else { emit("GAP_ACTIVATION_UNAVAILABLE") }
        guard try pollOwned(executable, condition: { try boolean(app, kAXFrontmostAttribute) == true }) else { emit("GAP_ACTIVATION_UNAVAILABLE") }
        try prepare(appMenu)
        guard AXUIElementPerformAction(appMenu, kAXPressAction as CFString) == .success else { emit("GAP_APP_MENU_ACTION_UNAVAILABLE") }
        var populatedAbout: AXUIElement?
        guard try pollOwned(executable, condition: {
            populatedAbout = try walk(appMenu, visitor: { node in
                try string(node, kAXRoleAttribute) == kAXMenuItemRole && string(node, kAXTitleAttribute) == "About BDOBB"
            })
            return populatedAbout != nil
        }), let about = populatedAbout else { emit("GAP_ABOUT_MENU_NOT_FOUND") }
        guard processPath(pid) == executable else { emit("ERROR_PID_PATH_MISMATCH") }
        try prepare(about)
        guard AXUIElementPerformAction(about, kAXPressAction as CFString) == .success else { emit("GAP_ABOUT_MENU_ACTION_UNAVAILABLE") }
        menuInvoked = true
        var sawCandidate = false
        var sawFocused = false
        while ProcessInfo.processInfo.systemUptime < deadline {
            guard processPath(pid) == executable else { emit("ERROR_PID_PATH_MISMATCH") }
            let windows = try children(app, kAXWindowsAttribute, limit: 16)
            let focused = try elementAttribute(app, kAXFocusedWindowAttribute)
            for window in windows {
                let title = try string(window, kAXTitleAttribute) ?? ""
                let newWindow = !before.contains(where: { CFEqual($0, window) })
                guard newWindow || title == "About BDOBB" || title == "About" else { continue }
                guard try string(window, kAXRoleAttribute) == kAXWindowRole else { continue }
                sawCandidate = true
                guard let focused, CFEqual(focused, window), try boolean(app, kAXFrontmostAttribute) == true,
                      try boolean(window, kAXMinimizedAttribute) != true,
                      try boolean(window, "AXHidden") != true else { continue }
                sawFocused = true
                let (names, versions) = try aboutTexts(window)
                if names.count == 1 && versions.count == 1 {
                    emit("AX_TEXT_OBSERVED", name: names.first, version: versions.first, focused: true)
                }
                if names.count > 1 || versions.count > 1 { emit("GAP_ABOUT_TEXT_AMBIGUOUS") }
            }
            Thread.sleep(forTimeInterval: 0.12)
        }
        if sawFocused { emit("GAP_ABOUT_STATIC_TEXT_UNAVAILABLE") }
        if sawCandidate { emit("GAP_ABOUT_VISIBILITY_UNCONFIRMED") }
        emit("GAP_ABOUT_WINDOW_NOT_FOUND")
    } catch ProbeFailure.timeout {
        emit("GAP_AX_TIMEOUT")
    } catch ProbeFailure.budget {
        emit("GAP_TRAVERSAL_BUDGET")
    } catch ProbeFailure.owner {
        emit("ERROR_AX_OWNER_MISMATCH")
    } catch {
        emit("GAP_APP_AX_UNAVAILABLE")
    }
}

main()
