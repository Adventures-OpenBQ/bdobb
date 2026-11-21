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
source = '944c6d725a29beed8d577e64fc2d8330d4260241'
tree = '53507fbfe83175f32edc5efda221058ecbd3be3d'
image = 'table-qualification:v8-944c6d7-amd64'
build = 'table-qualification:v8-944c6d7-amd64-build'
assert platform.system() == 'Linux' and platform.machine() == 'x86_64'
manifest = json.loads((context / '.table-source.json').read_text())
assert manifest['revision'] == source and manifest['tree'] == tree
assert manifest['sourceArchiveSha256'] == 'e88614f9d291d5b1f273b8148430603214518bba274359d11a31f4a4477855df'
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
assert count >= 78 and 'test result: FAILED' not in log
assert 'managed_statement_move_preserves_rows_formula_values_and_authentication ... ok' in log
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
archive = out / 'qualified-table-image-amd64.tar.gz'
with archive.open('wb') as output:
    saved = subprocess.Popen(['docker', 'save', image], stdout=subprocess.PIPE)
    compressed = subprocess.run(['gzip', '-1'], stdin=saved.stdout, stdout=output)
    saved.stdout.close()
    assert saved.wait() == 0 and compressed.returncode == 0
with archive.open('rb') as stream:
    archive_sha = hashlib.file_digest(stream, 'sha256').hexdigest()
receipt = {'docker_archive': archive.name, 'docker_archive_sha256': archive_sha,
    'rootfs_diff_ids': info['RootFS']['Layers'],
    'runtime_config_sha256': hashlib.sha256(json.dumps(info['Config'], sort_keys=True).encode()).hexdigest(),
    'result': 'PASS', 'architecture': info['Architecture'], 'runner_machine': platform.machine(),
    'runner_os': platform.system(), 'run_id': os.environ.get('GITHUB_RUN_ID'),
    'source_revision': source, 'source_tree': tree, 'image_id': info['Id'],
    'linux_release_tests': count, 'statement_line_placement': True, 'production_runtime': proof,
    'read_only_runtime': True, 'network_none_runtime': True, 'runtime_uid': info['Config']['User'],
    'no_host_ports': True, 'no_provider_keys': True,
    'runtime_smoke_sha256': hashlib.sha256(smoke.read_bytes()).hexdigest()}
(out / 'qualification.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt), flush=True)
