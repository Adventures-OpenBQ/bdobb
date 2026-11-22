#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only

"""Stage desktop release packages only after inspecting their installed bytes."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile


REPO = Path(__file__).resolve().parents[1]
DEFAULTS_META = "bdobb-build-defaults"
DEFAULTS = ("VITE_OPENBB_API_URL", "VITE_RITA_URL", "VITE_MCP_SERVERS", "VITE_SHARE_FOLDERS",
            "VITE_DEFAULT_BACKEND_URL", "VITE_DEFAULT_BACKEND_AUTH")
ASSIGNMENT = re.compile(
    rb'(?:["\x27`])?(' + b"|".join(key.encode() for key in DEFAULTS) +
    rb')(?:["\x27`])?\s*[:=]\s*(["\x27`])(?=\S)(?!\2)'
)
TAILNET = re.compile(rb"\b([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.ts\.net\b", re.I)
PLACEHOLDERS = {b"your-tailnet", b"tailnet-name", b"example", b"example-tailnet", b"tailxxxxxx"}
FORMATS = {
    "Linux": (".deb", ".rpm", ".AppImage"),
    "macOS": (".dmg", ".app.tar.gz"),
    "Windows": ("-setup.exe", ".msi"),
}


class GateError(Exception):
    pass


def check_bytes(data, label):
    # Scanned package and executable bytes include plain text and UTF-16
    # strings. Removing NULs exposes ASCII UTF-16 in either endianness.
    data = data.replace(b"\0", b"")
    if match := ASSIGNMENT.search(data):
        raise GateError(f"Nonempty {match[1].decode()} in {label}")
    for host in TAILNET.findall(data):
        if host.lower().rsplit(b".", 1)[-1] not in PLACEHOLDERS:
            raise GateError(f"Tailnet hostname in {label}")


def run(*args):
    result = subprocess.run(list(map(str, args)), capture_output=True, timeout=240)
    if result.returncode:
        raise GateError(f"{Path(str(args[0])).name} failed with exit {result.returncode}")


def extract_7z(source, dest):
    exe = shutil.which("7zz") or shutil.which("7z") or Path(r"C:\Program Files\7-Zip\7z.exe")
    run(exe, "x", "-y", f"-o{dest}", "--", source)


def squashfs_offset(source):
    data = source.read_bytes()
    candidates = []
    for match in re.finditer(b"hsqs", data):
        at = match.start()
        if at + 96 > len(data):
            continue
        block = struct.unpack_from("<I", data, at + 12)[0]
        codec, shift, _, _, major, minor = struct.unpack_from("<6H", data, at + 20)
        size = struct.unpack_from("<Q", data, at + 40)[0]
        if major == 4 and minor == 0 and 1 <= codec <= 6 and block == 1 << shift and 96 < size <= len(data) - at:
            candidates.append(at)
    if len(candidates) != 1:
        raise GateError("Expected a single SquashFS AppImage payload")
    return candidates[0]


def unpack(source, dest):
    suffix = source.suffix
    if suffix == ".dmg":
        mount = dest / "mount"
        mount.mkdir()
        run("hdiutil", "attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, source)
        try:
            shutil.copytree(mount, dest / "contents", symlinks=True)
        finally:
            run("hdiutil", "detach", mount)
    elif suffix == ".gz":
        with tarfile.open(source, "r:gz") as archive:
            archive.extractall(dest, filter="data")
    elif suffix == ".rpm":
        run("bsdtar", "-xf", source, "-C", dest)
    elif suffix == ".deb":
        run("bsdtar", "-xf", source, "-C", dest)
        pieces = [p for p in dest.iterdir() if p.name.startswith(("data.tar", "control.tar"))]
        if not any(piece.name.startswith("data.tar") for piece in pieces):
            raise GateError("Debian data archive missing")
        for piece in pieces:
            member = dest / (piece.name.split(".")[0] + "-contents")
            member.mkdir()
            run("bsdtar", "-xf", piece, "-C", member)
    elif suffix == ".AppImage":
        run("unsquashfs", "-no-progress", "-no-xattrs", "-o", squashfs_offset(source), "-d", dest / "contents", source)
    elif suffix in (".msi", ".exe"):
        extract_7z(source, dest / "installer")
        if suffix == ".msi":
            exe = shutil.which("7zz") or shutil.which("7z") or Path(r"C:\Program Files\7-Zip\7z.exe")
            run(exe, "x", "-tCompound", "-y", f"-o{dest / 'metadata'}", "--", source)
    else:
        raise GateError(f"Unsupported release format: {suffix}")


def scan_tree(root):
    files = []
    def unreadable(_error):
        raise GateError("Unreadable package directory")

    for directory, subdirs, names in os.walk(root, followlinks=False, onerror=unreadable):
        for name in sorted(subdirs + names):
            path = Path(directory) / name
            rel = path.relative_to(root)
            check_bytes(os.fsencode(str(rel)), "package path")
            if path.is_symlink():
                check_bytes(os.fsencode(os.readlink(path)), f"link {rel}")
            elif path.is_file():
                check_bytes(path.read_bytes(), str(rel))
                files.append(path)
            elif not path.is_dir():
                raise GateError("Unexpected file type in package")
    return files


def validate_appimage_link(root, link):
    """Resolve metadata component by component, never open through a symlink."""
    pending = list(link.relative_to(root).parts)
    resolved = []
    hops = 0
    while pending:
        part = pending.pop(0)
        if part in {"", "."}:
            continue
        if part == "..":
            if not resolved:
                raise GateError("AppImage link escapes its package")
            resolved.pop()
            continue
        candidate = root.joinpath(*resolved, part)
        try:
            mode = candidate.lstat().st_mode
        except OSError:
            raise GateError("Dangling or unreadable AppImage link") from None
        if stat.S_ISLNK(mode):
            hops += 1
            target = os.readlink(candidate)
            if hops > 40 or not target or target.startswith("/") or "\\" in target or re.match(r"^[A-Za-z]:", target):
                raise GateError("Unsafe or cyclic AppImage link")
            pending = target.split("/") + pending
        else:
            if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)) or pending and not stat.S_ISDIR(mode):
                raise GateError("AppImage link has an invalid target")
            resolved.append(part)


def appimage_scan_inputs(package, dest):
    """Scan physical members once and scan every validated raw link as metadata."""
    dest.mkdir()
    regular = dest / package.name
    regular.mkdir()
    metadata = dest / "appimage-links.txt"
    links = []

    def unreadable(_error):
        raise GateError("Unreadable AppImage package directory")

    for directory, subdirs, names in os.walk(package, followlinks=False, onerror=unreadable):
        for name in sorted(subdirs + names):
            path = Path(directory) / name
            relative = path.relative_to(package)
            mode = path.lstat().st_mode
            target = regular / relative
            if stat.S_ISLNK(mode):
                validate_appimage_link(package, path)
                # Keep original bytes, not JSON escapes or dereferenced content.
                links.append((os.fsencode(str(relative)), os.fsencode(os.readlink(path))))
            elif stat.S_ISDIR(mode):
                target.mkdir(parents=True, exist_ok=True)
            elif stat.S_ISREG(mode):
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
            else:
                raise GateError("Unexpected AppImage package member type")
    metadata.write_bytes(b"".join(path + b"\n" + target + b"\n" for path, target in sorted(links)))
    # A link-free package still needs a nonempty declared metadata scan target.
    if not links:
        metadata.write_bytes(b"AppImage contains no symbolic links\n")
    return regular, metadata


class FrontendIndex(HTMLParser):
    """Collect the metadata and entry dependencies from a generated Vite index."""

    INERT = {
        "iframe", "math", "noembed", "noframes", "noscript", "plaintext",
        "svg", "template", "textarea", "title", "xmp",
    }
    JAVASCRIPT_TYPES = {"", "application/javascript", "text/javascript"}

    def __init__(self):
        super().__init__()
        self.defaults = []
        self.scripts = []
        self.dependencies = []
        self.inert = []
        self.script = None

    def handle_starttag(self, tag, attrs):
        if tag in self.INERT:
            self.inert.append(tag)
        if self.inert:
            return
        attributes = dict(attrs)
        if tag == "base" and "href" in attributes:
            raise GateError("Unexpected base URL in embedded index")
        if tag == "meta" and any(
            key == "name" and value and value.lower() == DEFAULTS_META for key, value in attrs
        ):
            if len(attributes) != len(attrs):
                raise GateError("Invalid build defaults metadata")
            self.defaults.append(attributes.get("content"))
        if tag == "script" and "src" in attributes:
            if len(attributes) != len(attrs):
                raise GateError("Ambiguous script attributes in embedded index")
            script_type = (attributes.get("type") or "").strip().lower()
            is_javascript = script_type == "module" or (
                script_type in self.JAVASCRIPT_TYPES and "nomodule" not in attributes
            )
            self.script = (attributes["src"], is_javascript)
        if tag == "link":
            href = attributes.get("href")
            rel = (attributes.get("rel") or "").lower().split()
            if (
                "stylesheet" in rel or "modulepreload" in rel
                or ("preload" in rel and attributes.get("as") in {"script", "style"})
                or (href and href.startswith("/assets/"))
            ):
                if len(attributes) != len(attrs):
                    raise GateError("Ambiguous link attributes in embedded index")
                self.dependencies.append(href)

    def handle_endtag(self, tag):
        if self.inert:
            if self.inert[-1] == tag:
                self.inert.pop()
            return
        if tag == "script" and self.script is not None:
            self.scripts.append(self.script)
            self.script = None

    def handle_startendtag(self, tag, attrs):
        if tag in {"svg", "math"}:
            return
        # HTML void elements such as meta and link are commonly written with />.
        # For <script .../> the browser still requires a closing script tag.
        self.handle_starttag(tag, attrs)
        if tag == "script":
            self.set_cdata_mode(tag)


def unique_json_object(pairs):
    obj = dict(pairs)
    if len(obj) != len(pairs):
        raise ValueError("duplicate JSON key")
    return obj


def entry_file(frontend, reference):
    if not reference or not re.fullmatch(r"[A-Za-z0-9_./-]+", reference):
        raise GateError("Unsafe embedded entrypoint path")
    relative = reference.removeprefix("/").removeprefix("./")
    parts = relative.split("/")
    if any(part in {"", ".", ".."} or part.endswith(".") for part in parts):
        raise GateError("Unsafe embedded entrypoint path")
    path = frontend
    for part in parts:
        path /= part
        if path.is_symlink():
            raise GateError("Symlink in embedded entrypoint path")
    if not path.is_file() or not path.read_bytes().strip():
        raise GateError("Embedded entrypoint dependency missing or empty")
    return path


def check_frontend(frontend: Path) -> None:
    if frontend.is_symlink() or not frontend.is_dir():
        raise GateError("Embedded frontend missing")
    index = entry_file(frontend, "index.html")
    parser = FrontendIndex()
    parser.feed(index.read_text(encoding="utf-8"))
    parser.close()

    if len(parser.defaults) != 1 or parser.defaults[0] is None:
        raise GateError("Expected exactly one build defaults metadata tag")
    try:
        defaults = json.loads(parser.defaults[0], object_pairs_hook=unique_json_object)
    except (ValueError, RecursionError):
        raise GateError("Invalid build defaults metadata JSON") from None
    if not isinstance(defaults, dict) or set(defaults) != set(DEFAULTS) or not all(
        isinstance(value, str) for value in defaults.values()
    ):
        raise GateError("Invalid build defaults metadata object")
    for key, value in defaults.items():
        if value != "":
            raise GateError(f"Nonempty {key} in embedded build defaults")

    has_entry = False
    for reference, is_javascript in parser.scripts:
        path = entry_file(frontend, reference)
        if is_javascript and path.suffix in {".js", ".mjs"}:
            has_entry = True
    if parser.script is not None or not has_entry:
        raise GateError("Expected a complete local script in embedded index")
    for reference in parser.dependencies:
        entry_file(frontend, reference)


def sha256(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def checksum_line(name, digest):
    return f"{digest}  {name}"


def scan_artifacts(*paths):
    try:
        import PIL
        from PIL import Image
    except ImportError:
        raise GateError("Installer scanning requires pinned security/requirements.txt") from None
    if PIL.__version__ != "13.0.0" or not Image.core:
        raise GateError("Installer scanning requires the pinned Pillow decoder")

    result = subprocess.run(
        [sys.executable, REPO / "security/gate.py", "--repo", REPO, "artifacts", *paths],
        stdout=sys.stderr,
    )
    if result.returncode:
        raise GateError(f"Shared artifact gate failed with exit {result.returncode}")


def scan_package(asset):
    if asset.is_symlink() or not asset.is_file() or not asset.stat().st_size:
        raise GateError("Expected a nonempty regular release package")
    if any(character in asset.name for character in "\r\n\\!"):
        raise GateError("Unsafe release package filename")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        snapshot = root / asset.name
        shutil.copyfile(asset, snapshot)
        digest = sha256(snapshot)
        check_bytes(snapshot.read_bytes(), asset.name)
        raw = root / (asset.name + ".raw")
        os.link(snapshot, raw)
        checksum = root / (asset.name + ".sha256")
        checksum.write_bytes((checksum_line(asset.name, digest) + "\n").encode())

        package = root / "package"
        package.mkdir()
        unpack(snapshot, package)
        files = scan_tree(package)
        targets = [f for f in files if f.name.lower() in {"bdobb", "bdobb.exe", "path"}]
        if len(targets) != 1 or not targets[0].stat().st_size:
            raise GateError(f"Expected one nonempty BDOBB executable in {asset.name}")
        frontend = root / "frontend"
        run("tauri-dumper", "extract", targets[0], "-o", frontend, "--json")
        check_frontend(frontend)
        extracted = scan_tree(frontend)

        # The native gate handles DMG links and supported installer containers.
        # Linux's packages use the format-specific unpacker above, with every
        # unpacked member passed to the shared gate. All formats include raw bytes.
        if asset.suffix == ".AppImage":
            contents = list(appimage_scan_inputs(package, root / "appimage-scan"))
        elif asset.suffix in {".deb", ".rpm"}:
            contents = [package]
        elif asset.suffix == ".msi":
            contents = [snapshot, package / "metadata"]
        else:
            contents = [snapshot]
        scan_artifacts(raw, *contents, frontend, checksum)
        if sha256(snapshot) != digest or sha256(asset) != digest:
            raise GateError("Release package changed during artifact scan")
        return {"package_files": len(files), "frontend_files": len(extracted) - 1, "sha256": digest}


def select_assets(outputs, system):
    selected = []
    for extension in FORMATS[system]:
        matches = [p for p in outputs if p.is_file() and p.name.endswith(extension)]
        if len(matches) != 1:
            raise GateError(f"Expected one {extension} asset, found {len(matches)}")
        selected.append(matches[0])
    return selected


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in {"check", "stage"}:
        raise GateError("Use check PACKAGE... or stage with the workflow build outputs")
    if sys.argv[1] == "check":
        parser = argparse.ArgumentParser()
        parser.add_argument("--checksum", action="store_true", help="emit the scanned package's SHA-256 checksum")
        parser.add_argument("packages", nargs="+", type=Path)
        args = parser.parse_args(sys.argv[2:])
        if args.checksum and len(args.packages) != 1:
            raise GateError("One release package is required when emitting a checksum")
        for asset in args.packages:
            manifest = scan_package(asset)
            print(f"Passed {asset.name}: {manifest}", file=sys.stderr if args.checksum else sys.stdout)
            if args.checksum:
                print(checksum_line(asset.name, manifest["sha256"]))
        return
    outputs = [Path(p).resolve() for p in json.loads(os.environ["BDOBB_ARTIFACT_PATHS"])]
    system = os.environ["RUNNER_OS"]
    stage = Path("release-stage").resolve()
    stage.mkdir()
    if system == "macOS" and not any(p.name.endswith(".app.tar.gz") for p in outputs):
        app = next((p for p in outputs if p.is_dir() and p.suffix == ".app"), None)
        if app is None:
            dmgs = [p for p in outputs if p.suffix == ".dmg"]
            if len(dmgs) == 1:
                bundles = list((dmgs[0].parent.parent / "macos").glob("*.app"))
                if len(bundles) == 1:
                    app = bundles[0]
        if app is not None:
            architecture = os.environ["BDOBB_RUST_TARGET"].split("-")[0]
            archive = stage / f"BDOBB_{architecture}.app.tar.gz"
            run("tar", "-czf", archive, "-C", app.parent, app.name)
            outputs.append(archive)
    selected = select_assets(outputs, system)
    manifest = {}
    for source in selected:
        dest = stage / source.name
        if source != dest:
            shutil.copyfile(source, dest)
        manifest[dest.name] = scan_package(dest)
        print(f"Passed {dest.name}")
    (stage / "scan.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except (GateError, OSError, ValueError, subprocess.TimeoutExpired, tarfile.TarError) as error:
        print(str(error) if isinstance(error, GateError) else f"Release scan failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
