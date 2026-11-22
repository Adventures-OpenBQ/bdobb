# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only

import html
import importlib.util
import json
import os
import subprocess
import sys
import shutil
import tarfile
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("public-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

DEFAULTS = dict.fromkeys((
    "VITE_OPENBB_API_URL", "VITE_RITA_URL", "VITE_MCP_SERVERS", "VITE_SHARE_FOLDERS",
    "VITE_DEFAULT_BACKEND_URL", "VITE_DEFAULT_BACKEND_AUTH",
), "")
ENTRY = '<script type="module" src="/assets/entry.js"></script>'


def metadata(payload):
    return f'<meta name="bdobb-build-defaults" content="{html.escape(payload, quote=True)}">'


def scan_installer(index, frontend_files):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        binary = root / "bdobb"
        binary.write_bytes(b"synthetic executable")
        package = root / "BDOBB.app.tar.gz"
        with tarfile.open(package, "w:gz") as archive:
            archive.add(binary, arcname="BDOBB.app/Contents/MacOS/bdobb")

        def extract(command, operation, target, output_option, frontend, output_format):
            assert (command, operation, output_option, output_format) == (
                "tauri-dumper", "extract", "-o", "--json"
            )
            assert target.read_bytes() == b"synthetic executable"
            frontend.mkdir()
            (frontend / "index.html").write_text(index, encoding="utf-8")
            for path, contents in frontend_files.items():
                file = frontend / path
                file.parent.mkdir(exist_ok=True, parents=True)
                if isinstance(contents, Path):
                    file.symlink_to(contents)
                else:
                    file.write_bytes(contents)

        with patch.object(release, "run", side_effect=extract), patch.object(release, "scan_artifacts", create=True):
            return release.scan_package(package)


class PublicReleaseTests(unittest.TestCase):
    def test_installer_requires_exact_empty_runtime_metadata(self):
        clean = metadata(json.dumps(DEFAULTS))
        invalid = {
            "missing": ("", "build defaults"),
            "duplicate meta": (clean + clean, "build defaults"),
            "duplicate key": (metadata(json.dumps(DEFAULTS)[:-1] + ', "VITE_RITA_URL": ""}'), "build defaults"),
            "invalid JSON": (metadata("{"), "build defaults"),
            "wrong object type": (metadata("[]"), "build defaults"),
            "missing key": (metadata(json.dumps({key: "" for key in DEFAULTS if key != "VITE_RITA_URL"})), "build defaults"),
            "extra key": (metadata(json.dumps({**DEFAULTS, "EXTRA": ""})), "build defaults"),
            "non-string": (metadata(json.dumps({**DEFAULTS, "VITE_RITA_URL": None})), "build defaults"),
        }
        for key in DEFAULTS:
            invalid[key] = (metadata(json.dumps({**DEFAULTS, key: " synthetic "})), key)
        for case, (tag, reason) in invalid.items():
            with self.subTest(case=case), self.assertRaisesRegex(release.GateError, reason):
                scan_installer(tag + ENTRY, {"assets/entry.js": b"console.log(1)"})
        self.assertEqual(scan_installer(clean + ENTRY, {"assets/entry.js": b"console.log(1)"})["frontend_files"], 1)

    def test_installer_requires_complete_local_entrypoint(self):
        clean = metadata(json.dumps(DEFAULTS))
        js = {"assets/entry.js": b"console.log(1)"}
        cases = {
            "empty HTML and JS": ("", {"assets/entry.js": b""}),
            "blank HTML": ("  \n", js),
            "missing script element": (clean, js),
            "inert script element": (clean + '<script type="application/json" src="/assets/entry.js"></script>', js),
            "nomodule script element": (clean + '<script nomodule src="/assets/entry.js"></script>', js),
            "template script element": (clean + "<template>" + ENTRY + "</template>", js),
            "empty entry file": (clean + ENTRY, {**js, "assets/entry.js": b""}),
            "blank entry file": (clean + ENTRY, {**js, "assets/entry.js": b" \n"}),
            "missing required script": (clean + ENTRY + '<script src="assets/other.js"></script>', js),
            "missing stylesheet": (clean + ENTRY + '<link rel="stylesheet" href="/assets/main.css">', js),
            "remote script": (clean + ENTRY.replace("/assets", "//example.invalid"), js),
            "encoded traversal": (clean + ENTRY.replace("/assets", "/assets/%2e%2e/assets"), js),
            "traversal": (clean + ENTRY.replace("/assets", "/assets/../assets"), js),
            "symlink entry": (clean + ENTRY, {"assets/entry.js": Path(__file__).resolve()}),
            "external base": (clean + '<base href="https://example.invalid/">' + ENTRY, js),
        }
        for case, (index, files) in cases.items():
            with self.subTest(case=case), self.assertRaises(release.GateError):
                scan_installer(index, files)

    def test_rejects_minified_defaults_without_echoing_values(self):
        for key in release.DEFAULTS:
            payload = f'var e={{{key}:`https://internal.example.invalid`}}'.encode()
            with self.assertRaisesRegex(release.GateError, key):
                release.check_bytes(payload, "frontend.js")

    def test_rejects_private_tailnet_dns_in_binary_and_utf16(self):
        host = "internal." + "tail" + "0123abcd" + ".ts.net"
        for encoding in ("utf-8", "utf-16le", "utf-16be"):
            with self.assertRaisesRegex(release.GateError, "Tailnet hostname"):
                release.check_bytes(host.encode(encoding), "payload")

    def test_allows_empty_defaults_and_documentation_hosts(self):
        release.check_bytes(b'const e={VITE_RITA_URL:``,VITE_OPENBB_API_URL:"",VITE_MCP_SERVERS:\'\'};', "app.js")
        release.check_bytes(b"https://api.your-tailnet.ts.net", "help.md")

    def test_stager_enforces_every_target_bundle_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            asset = d / "app.deb"
            asset.touch()
            with self.assertRaisesRegex(release.GateError, "Expected"):
                release.select_assets([asset], "Linux")


    def test_rejects_v3_backend_defaults(self):
        for key in ("VITE_DEFAULT_BACKEND_URL", "VITE_DEFAULT_BACKEND_AUTH"):
            with self.subTest(key=key), self.assertRaisesRegex(release.GateError, key):
                release.check_bytes(f'const env={{{key}:"synthetic_nonempty_default"}}'.encode(), "frontend.js")

    def test_check_requires_an_actual_package(self):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("public-release.py")), "check"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)

    def test_release_clears_all_operator_defaults_before_the_native_build(self):
        defaults = ("VITE_OPENBB_API_URL", "VITE_RITA_URL", "VITE_MCP_SERVERS", "VITE_SHARE_FOLDERS", "VITE_DEFAULT_BACKEND_URL", "VITE_DEFAULT_BACKEND_AUTH")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "scripts").mkdir()
            (root / "bin").mkdir()
            (root / "security").mkdir()
            (root / "security/gate.py").write_text("raise SystemExit(0)\n")
            shutil.copyfile(Path(__file__).with_name("release.sh"), root / "scripts/release.sh")
            (root / "package.json").write_text('{"version":"3.0.0"}')
            (root / "scripts/scrub-check.sh").write_text("exit 0\n")
            git = root / "bin/git"
            git.write_text("#!/bin/sh\nif [ \"$1\" = rev-parse ]; then echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; fi\n")
            git.chmod(0o755)
            cargo = root / "bin/cargo"
            cargo.write_text("#!/bin/sh\nexit 0\n")
            cargo.chmod(0o755)
            pnpm = root / "bin/pnpm"
            pnpm.write_text("#!" + sys.executable + "\nimport json,os,sys\nif 'tauri:build' in sys.argv:\n open(os.environ['BUILD_CAPTURE'],'w').write(json.dumps({k:os.environ.get(k) for k in " + repr(defaults) + "}))\n sys.exit(91)\n")
            pnpm.chmod(0o755)
            capture = root / "capture.json"
            env = {**os.environ, "PATH": str(root / "bin") + os.pathsep + os.environ["PATH"], "BDOBB_RELEASE_DRY_RUN":"1", "BUILD_CAPTURE":str(capture)}
            env.update({key:"synthetic_nonempty_default" for key in defaults})
            env.update({key:"synthetic_test_signing_value" for key in ("APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID")})
            result = subprocess.run(["bash", str(root / "scripts/release.sh"), "v3.0.0"], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 91, result.stderr)
            self.assertEqual(json.loads(capture.read_text()), {key:"" for key in defaults})


if __name__ == "__main__":
    unittest.main()
