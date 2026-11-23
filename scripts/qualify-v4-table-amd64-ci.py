# Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
"""Pinned recipe qualification on a real Linux AMD64 GitHub runner; no provider keys."""
from pathlib import Path
import hashlib
import json
import os
import platform
import re
import subprocess

root = Path.cwd()
out = root / 'qualification-evidence'
out.mkdir(exist_ok=True)
context = root / 'table-context'
backend = root / 'backend'
source = 'b963af1f9be37a1754b7f568403b8c461c5dbc72'
tree = 'e8b331b5f813defc34cbbbb7aa6b5b5e0f3a3cb2'
image = 'table-qualification:v4-b963af1f-amd64'
build = 'table-qualification:v4-b963af1f-amd64-build'
assert platform.system() == 'Linux' and platform.machine() == 'x86_64'
manifest = json.loads((context / '.table-source.json').read_text())
assert manifest['revision'] == source and manifest['tree'] == tree
assert manifest['sourceArchiveSha256'] == 'aa993fa80d7fcc981ec7e4052aeead568962f2f5d2f865d26efb4d6155a88495'
(out / 'source.json').write_text(json.dumps(manifest, indent=2) + '\n')

def run(name, command, **kwargs):
    with (out / (name + '.log')).open('w') as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, **kwargs)
    print(name, result.returncode, flush=True)
    if result.returncode:
        print((out / (name + '.log')).read_text()[-16000:], flush=True)
    result.check_returncode()

build_args = ['--platform', 'linux/amd64', '--build-arg', 'BDOBB_SOURCE_REVISION=' + source,
              '--build-arg', 'BDOBB_SOURCE_TREE=' + tree,
              '-f', str(context / 'deploy/table-service/Dockerfile')]
run('production-build', ['docker', 'build', *build_args, '-t', image, str(context)])
run('toolchain-build', ['docker', 'build', *build_args, '--target', 'toolchain', '-t', build, str(context)])
info = json.loads(subprocess.check_output(['docker', 'image', 'inspect', image], text=True))[0]
assert info['Architecture'] == 'amd64'
assert info['Config']['Labels']['org.opencontainers.image.revision'] == source
assert info['Config']['User'] == '10001:10001'
run('linux-release-tests', ['docker', 'run', '--rm', '--cpus', '2', '--memory', '8g',
    '-e', 'CARGO_BUILD_JOBS=2', '-e', 'TABLE_INGEST_NODE=/opt/node/bin/node',
    '-e', 'TABLE_NATIVE_WORKER=/target/release/pivot-native-worker', build, 'sh', '-c',
    'mkdir -p /target/debug && ln -s /target/release/pivot-native-worker /target/debug/pivot-native-worker '
    '&& cargo test --locked --release --manifest-path crates/table-service/Cargo.toml -- --test-threads=2'])
log = (out / 'linux-release-tests.log').read_text()
count = sum(map(int, re.findall(r'test result: ok\. (\d+) passed', log)))
assert count == 79 and 'test result: FAILED' not in log
assert 'managed_capabilities_advertise_implemented_scalar_functions ... ok' in log
assert 'managed_statement_move_preserves_rows_formula_values_and_authentication ... ok' in log
run('linux-core-tests', ['docker', 'run', '--rm', '--cpus', '2', '--memory', '8g',
    '-e', 'CARGO_BUILD_JOBS=2', build, 'sh', '-c',
    'cargo test --locked --release --manifest-path crates/pivot-core/Cargo.toml -- --test-threads=2'])
core_log = (out / 'linux-core-tests.log').read_text()
core_count = sum(map(int, re.findall(r'test result: ok\. (\d+) passed', core_log)))
assert core_count == 213 and 'test result: FAILED' not in core_log
assert 'chronological_measures_block_invalid_bound_dates_when_date_category_is_off_axes ... ok' in core_log
# Gateway dependencies stay outside the pinned production table image.
run('gateway-install', ['npm', 'ci', '--ignore-scripts'], cwd=backend / 'funnel-gateway')
smoke = root / 'deploy/table-service/runtime-smoke.mjs'
run('production-runtime-smoke', ['docker', 'run', '--rm', '--network', 'none', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '8g', '--pids-limit', '128',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=536870912,mode=1777',
    '-v', str(backend / 'funnel-gateway') + ':/qualification-gateway:ro',
    '-v', str(smoke) + ':/qualification/runtime-smoke.mjs:ro',
    '-e', 'TABLE_SMOKE_GATEWAY=/qualification-gateway/server.mjs',
    '-e', 'TABLE_SMOKE_SERVICE=/app/bin/table-service',
    '-e', 'TABLE_SMOKE_WORKER=/app/bin/pivot-native-worker',
    '-e', 'TABLE_SMOKE_INGEST=/app/server/table-ingest/dist/child.mjs',
    image, 'node', '/qualification/runtime-smoke.mjs'])
proof = json.loads(next(line for line in (out / 'production-runtime-smoke.log').read_text().splitlines()
    if line.startswith('{') and '"PASS"' in line))
assert proof['result'] == 'PASS'
assert proof['invalidBoundDateBlocked'] and proof['nativeScalarValues']
assert proof['advertisedScalarFunctions'] == ['LN', 'SQRT']
candidate = Path(os.environ['RUNNER_TEMP']) / 'candidate-table-image-amd64.tar.gz'
archive = out / 'qualified-table-image-amd64.tar.gz'
with candidate.open('wb') as output:
    saved = subprocess.Popen(['docker', 'save', info['Id']], stdout=subprocess.PIPE)
    compressed = subprocess.run(['gzip', '-1'], stdin=saved.stdout, stdout=output)
    saved.stdout.close()
    assert saved.wait() == 0 and compressed.returncode == 0
with candidate.open('rb') as stream:
    candidate_sha = hashlib.file_digest(stream, 'sha256').hexdigest()
identity = {'source_revision': source, 'source_tree': tree, 'architecture': info['Architecture'],
    'candidate_sha256': candidate_sha, 'image_id': info['Id'], 'service_tests': count,
    'core_tests': core_count, 'runtime_passed': proof['result'] == 'PASS'}
(candidate.parent / 'candidate-table-image-amd64.identity.json').write_text(json.dumps(identity, indent=2) + '\n')
run('image-privacy-gate', [str(root / '.scanner-venv/bin/python'),
    str(root / 'input-source/security/gate.py'), '--repo', str(root / 'input-source'),
    '--report', str(out / 'image-privacy.json'), 'image-archive', str(candidate)])
with candidate.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == candidate_sha
candidate.replace(archive) # Only cleared bytes enter the upload directory.
with archive.open('rb') as stream:
    archive_sha = hashlib.file_digest(stream, 'sha256').hexdigest()
receipt = {'docker_archive': archive.name, 'docker_archive_sha256': archive_sha,
    'rootfs_diff_ids': info['RootFS']['Layers'],
    'runtime_config_sha256': hashlib.sha256(json.dumps(info['Config'], sort_keys=True).encode()).hexdigest(),
    'result': 'PASS', 'architecture': info['Architecture'], 'runner_machine': platform.machine(),
    'runner_os': platform.system(), 'run_id': os.environ.get('GITHUB_RUN_ID'),
    'source_revision': source, 'source_tree': tree, 'image_id': info['Id'],
    'linux_release_tests': count, 'linux_core_tests': core_count, 'saved_image_privacy': 'PASS', 'statement_line_placement': True, 'production_runtime': proof,
    'read_only_runtime': True, 'network_none_runtime': True, 'runtime_uid': info['Config']['User'],
    'no_host_ports': True, 'no_provider_keys': True,
    'runtime_smoke_sha256': hashlib.sha256(smoke.read_bytes()).hexdigest()}
(out / 'qualification.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt), flush=True)
