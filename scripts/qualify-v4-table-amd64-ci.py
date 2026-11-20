# Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
"""Pinned recipe qualification on a real Linux AMD64 GitHub runner; no provider keys."""
from pathlib import Path
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess

root = Path.cwd()
out = root / 'qualification-evidence'
out.mkdir(exist_ok=True)
context = root / 'table-context'
backend = root / 'backend'
source = '1453fa7b4a8928baa106edbe84a9d36f8c260161'
tree = '59e784c16d08c7211810af64083a102223519623'
image = 'table-qualification:v4-1453-amd64'
build = 'table-qualification:v4-1453-amd64-build'
assert platform.system() == 'Linux' and platform.machine() == 'x86_64'
manifest = json.loads((context / '.table-source.json').read_text())
assert manifest['revision'] == source and manifest['tree'] == tree
assert manifest['sourceArchiveSha256'] == '5a7d11053a6b84381e9c4fa11ab8a5e1532a2ef73f272506ea5a208256f19d7e'
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
assert count == 77 and 'test result: FAILED' not in log
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
receipt = {'result': 'PASS', 'architecture': info['Architecture'], 'runner_machine': platform.machine(),
    'runner_os': platform.system(), 'run_id': os.environ.get('GITHUB_RUN_ID'),
    'source_revision': source, 'source_tree': tree, 'image_id': info['Id'],
    'linux_release_tests': count, 'production_runtime': proof,
    'read_only_runtime': True, 'network_none_runtime': True, 'runtime_uid': info['Config']['User'],
    'no_host_ports': True, 'no_provider_keys': True,
    'runtime_smoke_sha256': hashlib.sha256(smoke.read_bytes()).hexdigest()}
(out / 'qualification.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt), flush=True)
