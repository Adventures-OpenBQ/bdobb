"""Native AX About observer; no permission requests or metadata-as-UI fallback."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import struct
import subprocess
import sys
import tempfile

SOURCE = 'fecff636e2389d417a320b66c9264d612ebb3a64'
OFFER = '00b661cf92ed7bebfa52a104b99ed5e9cb52e0873a2370fad1b22a07fe58633c'
GAPS = {'GAP_AX_NOT_TRUSTED', 'GAP_APP_AX_UNAVAILABLE', 'GAP_APP_MENU_NOT_FOUND', 'GAP_ACTIVATION_UNAVAILABLE',
        'GAP_APP_MENU_ACTION_UNAVAILABLE', 'GAP_ABOUT_MENU_NOT_FOUND', 'GAP_ABOUT_MENU_ACTION_UNAVAILABLE',
        'GAP_ABOUT_WINDOW_NOT_FOUND', 'GAP_ABOUT_VISIBILITY_UNCONFIRMED', 'GAP_ABOUT_STATIC_TEXT_UNAVAILABLE',
        'GAP_ABOUT_TEXT_AMBIGUOUS', 'GAP_TRAVERSAL_BUDGET', 'GAP_AX_TIMEOUT'}
ERRORS = {'ERROR_HOST_GUARD', 'ERROR_ARGUMENTS', 'ERROR_PID_PATH_MISMATCH', 'ERROR_EXECUTABLE_SHA_MISMATCH', 'ERROR_AX_OWNER_MISMATCH'}


class ProbeError(Exception):
    """Static code only; never include captured UI, source or command output."""


def file_hash(path):
    with os.fdopen(os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)), 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode): raise ProbeError('ERROR_EXECUTABLE_NOT_REGULAR')
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def classify_observation(value):
    invalid = {'status': 'GAP_PROBE_OUTPUT_INVALID'}
    allowed = {'status', 'origin', 'ax_trusted', 'menu_invoked', 'owned_window_focused', 'name_text', 'version_text', 'nodes_visited'}
    if not isinstance(value, dict) or set(value) - allowed or value.get('origin') != 'AX_OWNED_ABOUT_STATIC_TEXT': return invalid
    count = value.get('nodes_visited')
    if type(count) is not int or not 0 <= count <= 257 or any(type(value.get(key)) is not bool for key in ['ax_trusted', 'menu_invoked', 'owned_window_focused']): return invalid
    status = value.get('status')
    safe = {'status': status, 'ax_trusted': value['ax_trusted'], 'menu_invoked': value['menu_invoked'], 'nodes_visited': count}
    if status in GAPS or status in ERRORS:
        if status == 'GAP_AX_NOT_TRUSTED' and (value['ax_trusted'] or value['menu_invoked'] or value['owned_window_focused']): return invalid
        return safe
    if status != 'AX_TEXT_OBSERVED' or value['ax_trusted'] is not True or value['menu_invoked'] is not True: return invalid
    if value['owned_window_focused'] is not True: return {'status': 'GAP_ABOUT_VISIBILITY_UNCONFIRMED'}
    name, version = value.get('name_text'), value.get('version_text')
    if name != 'BDOBB' or not isinstance(version, str) or len(version) > 128: return {'status': 'GAP_ABOUT_STATIC_TEXT_UNAVAILABLE'}
    version = ' '.join(version.split())
    if not re.fullmatch(r'Version [0-9]+(?:\.[0-9]+){1,3} \([0-9]+(?:\.[0-9]+){1,3}\)', version): return {'status': 'GAP_ABOUT_STATIC_TEXT_UNAVAILABLE'}
    safe.update(status='OBSERVED_VERSION_MATCH' if version == 'Version 4.0.0 (4.0.0)' else 'FAIL_DISPLAYED_VERSION_MISMATCH',
                origin='AX_OWNED_ABOUT_STATIC_TEXT', owned_window_focused=True, name_text=name, version_text=version)
    return safe


def require_hosted_macos(expected_arch):
    actual = {'arm64': 'aarch64'}.get(platform.machine(), platform.machine())
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or os.environ.get('RUNNER_OS') != 'macOS' or platform.system() != 'Darwin' or actual != expected_arch:
        raise ProbeError('ERROR_HOST_GUARD')


def validate_executable(path, runner_temp, expected_sha, expected_arch):
    if path.is_symlink() or not path.is_relative_to(runner_temp) or not re.fullmatch('[0-9a-f]{64}', expected_sha): raise ProbeError('ERROR_EXECUTABLE_PATH_GUARD')
    if file_hash(path) != expected_sha: raise ProbeError('ERROR_EXECUTABLE_SHA_MISMATCH')
    with path.open('rb') as stream: header = stream.read(64)
    expected = {'aarch64': 0x100000C, 'x86_64': 0x1000007}[expected_arch]
    if len(header) != 64 or header[:4] != b'\xcf\xfa\xed\xfe' or struct.unpack_from('<I', header, 4)[0] != expected:
        raise ProbeError('ERROR_NATIVE_ARCHITECTURE_MISMATCH')


def process_path(pid):
    library = ctypes.CDLL('/usr/lib/libproc.dylib')
    function = library.proc_pidpath
    function.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    function.restype = ctypes.c_int
    buffer = ctypes.create_string_buffer(4096)
    if function(pid, buffer, len(buffer)) <= 0: raise ProbeError('ERROR_TARGET_PROCESS_UNAVAILABLE')
    return Path(buffer.value.decode('utf-8')).resolve(strict=True)


def validate_owned_process(pid, executable):
    if pid <= 0 or process_path(pid) != executable: raise ProbeError('ERROR_PID_PATH_MISMATCH')
    owner = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'uid='], capture_output=True, text=True, timeout=2)
    if owner.returncode or owner.stdout.strip() != str(os.getuid()): raise ProbeError('ERROR_PROCESS_OWNER_MISMATCH')


def observe(args):
    require_hosted_macos(args.expected_arch)
    runner_temp = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    workspace = Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True)
    executable_input = Path(args.executable).absolute()
    if executable_input.is_symlink(): raise ProbeError('ERROR_EXECUTABLE_PATH_GUARD')
    executable = executable_input.resolve(strict=True)
    evidence = Path(args.evidence_dir).resolve(strict=True)
    temp = Path(args.temp_dir).resolve(strict=True)
    if not temp.is_dir() or not temp.is_relative_to(runner_temp): raise ProbeError('ERROR_TEMP_PATH_GUARD')
    if not evidence.is_dir() or evidence in {workspace, runner_temp} or not any(evidence.is_relative_to(root) for root in [workspace, runner_temp]): raise ProbeError('ERROR_EVIDENCE_PATH_GUARD')
    output = evidence / 'mac-about.json'
    if output.exists() or output.is_symlink(): raise ProbeError('ERROR_EVIDENCE_ALREADY_EXISTS')
    validate_executable(executable, runner_temp, args.sha256, args.expected_arch)
    validate_owned_process(args.pid, executable)
    source = Path(__file__).with_name('mac_about_probe.swift')
    if source.is_symlink() or not source.is_file(): raise ProbeError('ERROR_SWIFT_SOURCE_GUARD')
    result = None
    with tempfile.TemporaryDirectory(prefix='v4-about-observer-', dir=temp) as private:
        work = Path(private)
        probe = work / 'mac-about-observer'
        try:
            build = subprocess.run(['/usr/bin/xcrun', 'swiftc', '-O', '-module-cache-path', str(work / 'module-cache'),
                                    '-framework', 'ApplicationServices', '-framework', 'CryptoKit', str(source), '-o', str(probe)],
                                   capture_output=True, timeout=90)
            if build.returncode != 0: result = {'status': 'GAP_HELPER_COMPILE_FAILED'}
        except subprocess.TimeoutExpired:
            result = {'status': 'GAP_HELPER_COMPILE_TIMEOUT'}
        if result is None:
            validate_owned_process(args.pid, executable)
            try:
                observed = subprocess.run([str(probe), '--pid', str(args.pid), '--executable', str(executable), '--sha256', args.sha256],
                                          capture_output=True, timeout=15)
                result = classify_observation(json.loads(observed.stdout)) if observed.stdout else {'status': 'GAP_PROBE_OUTPUT_INVALID'}
                if observed.returncode not in {0, 2}: result = {'status': 'GAP_PROBE_FAILED'}
            except subprocess.TimeoutExpired:
                result = {'status': 'GAP_PROBE_TIMEOUT'}
            except (ValueError, UnicodeError):
                result = {'status': 'GAP_PROBE_OUTPUT_INVALID'}
    validate_owned_process(args.pid, executable)
    validate_executable(executable, runner_temp, args.sha256, args.expected_arch)
    record = {'schema': 1, 'method': 'PID-scoped native AX app-menu About observer; no permission requests or metadata-as-UI fallback',
              'source_commit': SOURCE, 'source_offer_id': OFFER, 'pid': args.pid, 'executable_sha256': args.sha256,
              'native_architecture': args.expected_arch, 'swift_source_sha256': file_hash(source),
              'ax_phase_timeout_seconds': 10, 'process_timeout_seconds': 15, 'maximum_nodes': 256, **result}
    with output.open('x', encoding='utf-8', newline='\n') as stream: stream.write(json.dumps(record, indent=2) + '\n')
    output.chmod(0o600)
    return record


class SafeParser(argparse.ArgumentParser):
    def error(self, _message): raise ProbeError('ERROR_ARGUMENTS')


def main(argv=None):
    try:
        parser = SafeParser(description=__doc__, add_help=False)
        parser.add_argument('--pid', type=int, required=True)
        for name in ['executable', 'sha256', 'evidence-dir', 'temp-dir']: parser.add_argument('--' + name, required=True)
        parser.add_argument('--expected-arch', choices=['aarch64', 'x86_64'], required=True)
        record = observe(parser.parse_args(argv))
        print(json.dumps({'status': record['status'], 'receipt': 'mac-about.json'}))
        return 2 if record['status'].startswith(('ERROR_', 'FAIL_')) else 0
    except Exception as error:
        code = str(error) if isinstance(error, ProbeError) and re.fullmatch('[A-Z_]+', str(error)) else 'ERROR_PROBE_OPERATION_FAILED'
        print(json.dumps({'status': 'ERROR_ABOUT_PROBE', 'code': code}), file=sys.stderr)
        return 2


if __name__ == '__main__': raise SystemExit(main())
