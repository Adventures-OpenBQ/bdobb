import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('about', Path(__file__).with_name('mac_about_probe.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class AboutTests(unittest.TestCase):
    def observation(self, version='Version 4.0.0 (4.0.0)'):
        return {'status': 'AX_TEXT_OBSERVED', 'origin': 'AX_OWNED_ABOUT_STATIC_TEXT', 'ax_trusted': True,
                'menu_invoked': True, 'owned_window_focused': True, 'name_text': 'BDOBB', 'version_text': version, 'nodes_visited': 9}

    def test_only_owned_visible_about_static_text_proves_displayed_version(self):
        reply = p.classify_observation(self.observation())
        self.assertEqual(reply['status'], 'OBSERVED_VERSION_MATCH')
        self.assertEqual(reply['version_text'], 'Version 4.0.0 (4.0.0)')
        wrong = p.classify_observation(self.observation('Version 3.0.1 (3.0.1)'))
        self.assertEqual(wrong['status'], 'FAIL_DISPLAYED_VERSION_MISMATCH')

    def test_metadata_and_unfocused_text_cannot_become_ui_proof(self):
        metadata = {'status': 'AX_TEXT_OBSERVED', 'bundle_name': 'BDOBB', 'CFBundleShortVersionString': '4.0.0'}
        self.assertEqual(p.classify_observation(metadata)['status'], 'GAP_PROBE_OUTPUT_INVALID')
        reply = self.observation()
        reply['owned_window_focused'] = False
        result = p.classify_observation(reply)
        self.assertEqual(result['status'], 'GAP_ABOUT_VISIBILITY_UNCONFIRMED')
        self.assertNotIn('version_text', result)

    def test_untrusted_gap_and_invalid_text_discard_all_captured_text(self):
        reply = self.observation()
        reply.update(status='GAP_AX_NOT_TRUSTED', ax_trusted=False, menu_invoked=False, owned_window_focused=False)
        result = p.classify_observation(reply)
        self.assertEqual(result['status'], 'GAP_AX_NOT_TRUSTED')
        self.assertNotIn('version_text', result)
        bad = p.classify_observation(self.observation('PRIVATE_UNKNOWN_TEXT'))
        self.assertEqual(bad['status'], 'GAP_ABOUT_STATIC_TEXT_UNAVAILABLE')
        self.assertNotIn('PRIVATE_UNKNOWN_TEXT', json.dumps(bad))

    def test_executable_hash_and_native_thin_architecture_are_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            binary = root / 'bdobb'
            data = bytearray(64)
            data[:4] = b'\xcf\xfa\xed\xfe'
            struct.pack_into('<I', data, 4, 0x100000C)
            binary.write_bytes(data)
            expected = hashlib.sha256(data).hexdigest()
            p.validate_executable(binary, root, expected, 'aarch64')
            with self.assertRaises(p.ProbeError): p.validate_executable(binary, root, '0' * 64, 'aarch64')
            with self.assertRaises(p.ProbeError): p.validate_executable(binary, root, expected, 'x86_64')

    def test_host_guard_and_cli_errors_never_expose_exception_details(self):
        with mock.patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}, clear=False):
            with self.assertRaises(p.ProbeError): p.require_hosted_macos('aarch64')
        stdout, stderr = io.StringIO(), io.StringIO()
        args = ['--pid', '123', '--executable', '/tmp/app', '--sha256', 'a' * 64, '--expected-arch', 'aarch64', '--evidence-dir', '/tmp/evidence', '--temp-dir', '/tmp/work']
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr), mock.patch.object(p, 'observe', side_effect=RuntimeError('PRIVATE_EXCEPTION_DETAIL')):
            result = p.main(args)
        self.assertNotEqual(result, 0)
        self.assertNotIn('PRIVATE_EXCEPTION_DETAIL', stdout.getvalue() + stderr.getvalue())
        self.assertEqual(json.loads(stderr.getvalue())['status'], 'ERROR_ABOUT_PROBE')


if __name__ == '__main__': unittest.main()
