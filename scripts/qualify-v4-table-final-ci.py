# Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only
"""Dispatch-only, native Linux qualification. Raw logs/candidates never enter outbound evidence."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import uuid

SOURCE = '6c17f0f31af8dedd8ecf903719f8c8953035e43a'
TREE = '54b8f50e0a01c06f604919c7e104759ae273ae22'
ARCHIVE_SHA = '46af7695bef5bbb8cc874e796b3ccca2fa22176efe98d5b83f3786c4f4710787'
BACKEND = 'ff26495a9b43815605e1b8774f084f9d3b0388d6'
OFFER = 'a2520b860843e562ad9357ad3f7506ee216913f940aabe49875d024bfecce3ba'
DOCKERFILE_SHA = 'e3a9e2cd0cd5d96d8be057f2084f14566180b5f89f09ff913b6ffaa3784a2fe4'
TARGETS = {'amd64': 'x86_64', 'arm64': 'aarch64'}
SERVICE_NAMES = ['managed_capabilities_advertise_implemented_scalar_functions',
                 'managed_statement_move_preserves_rows_formula_values_and_authentication',
                 'empty_raw_column_is_valid_but_row_and_source_identities_stay_required']
CORE_NAMES = ['chronological_measures_block_invalid_bound_dates_when_date_category_is_off_axes',
 'empty_raw_key_survives_sort_filter_layout_and_linked_subset_chart',
 'legacy_implicit_empty_source_has_raw_metadata_without_empty_measure_identity',
 'legacy_empty_group_field_and_explicit_nonempty_measure_bind_exact_raw_key',
 'empty_opaque_identities_wrong_types_and_resource_limits_still_refuse',
 'analytical_definition_identities_and_authoring_contract_are_not_relaxed']

class QualificationError(Exception):
    pass

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def require(value, code):
    if not value:
        raise QualificationError(code)

def validate_manifest(value):
    require(value.get('revision') == SOURCE and value.get('tree') == TREE and
            value.get('sourceArchiveSha256') == ARCHIVE_SHA, 'SOURCE_MANIFEST_MISMATCH')

def test_count(log, count, names):
    passed = sum(map(int, re.findall(r'test result: ok\. (\d+) passed', log)))
    require(passed == count and 'test result: FAILED' not in log and
            all(name + ' ... ok' in log for name in names), 'LINUX_TEST_PROOF_MISMATCH')
    return passed

def validate_runtime(proof):
    require(proof.get('result') == 'PASS' and proof.get('node') == '26.10.0' and
            proof.get('icu') == '78.3' and type(proof.get('containedWorkers')) is int and
            proof['containedWorkers'] >= 2, 'RUNTIME_TOOLCHAIN_OR_CONTAINMENT_MISMATCH')
    for field in ['invalidBoundDateBlocked', 'nativeScalarValues', 'upload', 'foreignOwnerRefused',
                  'desktopSpoofRefused', 'restartReopen', 'oldSessionUnavailable']:
        require(proof.get(field) is True, 'RUNTIME_PROOF_INCOMPLETE')
    require(proof.get('advertisedScalarFunctions') == ['LN','SQRT'], 'SCALAR_PROOF_MISMATCH')
    require(proof.get('rawFields') == {'uploadedRows':3,'uploadedColumns':8,
        'filteredEmptyValues':[101,301],'prototypeValues':[102,302],
        'linkedEmptyValues':[101,301],'chartM1':[100,300],
        'opaqueRequestWidgetMeasureIdsRejected':True}, 'RAW_FIELD_PROOF_MISMATCH')

def host_guard(target):
    require(target in TARGETS and platform.system() == 'Linux' and
            platform.machine() == TARGETS[target] and os.environ.get('GITHUB_ACTIONS') == 'true' and
            os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted' and
            os.environ.get('RUNNER_OS') == 'Linux', 'HOSTED_NATIVE_LINUX_REQUIRED')

def catalog_mount(volume):
    require(bool(re.fullmatch('v4-table-6c17-[0-9a-f]{32}',volume)), 'UNOWNED_CATALOG_VOLUME')
    return 'type=volume,source='+volume+',target=/var/lib/table-service,volume-nocopy'

# No image directory content may seed the new catalog. Root can initialize only
# this empty mounted volume; the production runtime remains uid10001:10001.
INITIALIZE_CATALOG = """const fs=require('node:fs');const p='/var/lib/table-service';
if(fs.readdirSync(p).length!==0)process.exit(1);
fs.chmodSync(p,0o700);fs.chownSync(p,10001,10001);
const s=fs.lstatSync(p);if(!s.isDirectory()||s.uid!==10001||s.gid!==10001||(s.mode&0o777)!==0o700)process.exit(1);
"""

def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', choices=TARGETS, required=True)
    args = parser.parse_args(argv)
    host_guard(args.target)
    root = Path.cwd().resolve()
    runner = Path(os.environ['RUNNER_TEMP']).resolve()
    private = runner / ('v4-table-private-' + uuid.uuid4().hex)
    private.mkdir(mode=0o700)
    out = root / 'qualification-evidence'
    require(not out.exists(), 'OUTBOUND_DIRECTORY_EXISTS')
    out.mkdir(mode=0o700)
    context, backend = root/'table-context', root/'backend'
    for path, revision in [(root, os.environ.get('GITHUB_SHA','')), (root/'input-source',SOURCE), (backend,BACKEND)]:
        require(bool(re.fullmatch('[0-9a-f]{40}',revision)), 'REVISION_PIN_MISSING')
        require(subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip() == revision, 'CHECKOUT_PIN_MISMATCH')
        require(subprocess.run(['git','-C',str(path),'diff','--quiet','HEAD','--']).returncode == 0, 'TRACKED_CHECKOUT_CHANGED')
    require(json.loads((root/'input-source/source-offer.json').read_text())['sourceId'] == OFFER, 'SOURCE_OFFER_MISMATCH')
    manifest = json.loads((context/'.table-source.json').read_text())
    validate_manifest(manifest)
    require(sha(context/'deploy/table-service/Dockerfile') == DOCKERFILE_SHA, 'RECIPE_CHANGED')
    nonce = uuid.uuid4().hex
    image, build = ('table-qualification:v4-6c17-' + args.target + '-' + nonce + suffix for suffix in ['', '-toolchain'])
    volume = 'v4-table-6c17-' + nonce
    container = 'v4-table-runtime-' + nonce
    service_container = 'v4-table-service-tests-' + nonce
    core_container = 'v4-table-core-tests-' + nonce
    initializer_container = 'v4-table-catalog-init-' + nonce
    stage = 'START'
    volume_created = False
    def run(name, command, **kwargs):
        nonlocal stage
        stage = name
        log = private / (name + '.log')
        with log.open('w') as stream:
            result = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT, timeout=kwargs.pop('timeout', 3600), **kwargs)
        require(result.returncode == 0, 'COMMAND_FAILED')
        return log.read_text(errors='strict')
    try:
        build_args = ['--platform','linux/'+args.target,'--build-arg','BDOBB_SOURCE_REVISION='+SOURCE,
                      '--build-arg','BDOBB_SOURCE_TREE='+TREE,'-f',str(context/'deploy/table-service/Dockerfile')]
        run('PRODUCTION_BUILD',['docker','build',*build_args,'-t',image,str(context)])
        run('TOOLCHAIN_BUILD',['docker','build',*build_args,'--target','toolchain','-t',build,str(context)])
        stage = 'IMAGE_IDENTITY'
        info = json.loads(subprocess.check_output(['docker','image','inspect',image]))[0]
        require(info['Architecture'] == args.target and info['Os'] == 'linux' and
                info['Config']['Labels']['org.opencontainers.image.revision'] == SOURCE and
                info['Config']['Labels']['com.bdobb.source-tree'] == TREE and
                info['Config']['Labels']['com.bdobb.node'] == '26.10.0' and
                info['Config']['Labels']['com.bdobb.rust'] == '1.98.1' and
                info['Config']['Labels']['com.bdobb.icu'] == '78.3' and
                info['Config']['User'] == '10001:10001' and re.fullmatch('sha256:[0-9a-f]{64}',info['Id']), 'IMAGE_IDENTITY_MISMATCH')
        service_log = run('LINUX_SERVICE_TESTS',['docker','run','--name',service_container,'--rm','--cpus','2','--memory','8g',
          '-e','CARGO_BUILD_JOBS=2','-e','TABLE_INGEST_NODE=/opt/node/bin/node',
          '-e','TABLE_NATIVE_WORKER=/target/release/pivot-native-worker',build,'sh','-c',
          'mkdir -p /target/debug && ln -s /target/release/pivot-native-worker /target/debug/pivot-native-worker && cargo test --locked --release --manifest-path crates/table-service/Cargo.toml -- --test-threads=2'])
        service_count = test_count(service_log,80,SERVICE_NAMES)
        core_log = run('LINUX_CORE_TESTS',['docker','run','--name',core_container,'--rm','--cpus','2','--memory','8g',
          '-e','CARGO_BUILD_JOBS=2',build,'cargo','test','--locked','--release','--manifest-path','crates/pivot-core/Cargo.toml','--','--test-threads=2'])
        core_count = test_count(core_log,218,CORE_NAMES)
        run('GATEWAY_INSTALL',['npm','ci','--ignore-scripts'],cwd=backend/'funnel-gateway')
        run('FRESH_CATALOG_VOLUME',['docker','volume','create',volume])
        volume_created = True
        run('INITIALIZE_EMPTY_CATALOG',['docker','run','--name',initializer_container,'--rm',
          '--network','none','--read-only','--user','0:0','--cap-drop','ALL','--cap-add','CHOWN',
          '--security-opt','no-new-privileges','--memory','128m','--pids-limit','32',
          '--mount',catalog_mount(volume),info['Id'],'node','-e',INITIALIZE_CATALOG],timeout=30)
        runtime_log = run('PRODUCTION_RUNTIME',['docker','run','--name',container,'--rm','--network','none','--read-only',
          '--cap-drop','ALL','--security-opt','no-new-privileges','--memory','8g','--pids-limit','128',
          '--tmpfs','/tmp:rw,nosuid,nodev,size=536870912,mode=1777',
          '--mount',catalog_mount(volume),
          '--mount','type=bind,source='+str(backend/'funnel-gateway')+',target=/qualification-gateway,readonly',
          '--mount','type=bind,source='+str(root/'deploy/table-service')+',target=/qualification,readonly',
          '-e','TABLE_SMOKE_DATA_ROOT=/var/lib/table-service',
          '-e','TABLE_SMOKE_GATEWAY=/qualification-gateway/server.mjs','-e','TABLE_SMOKE_SERVICE=/app/bin/table-service',
          '-e','TABLE_SMOKE_WORKER=/app/bin/pivot-native-worker','-e','TABLE_SMOKE_INGEST=/app/server/table-ingest/dist/child.mjs',
          info['Id'],'node','/qualification/runtime-smoke.mjs'],timeout=240)
        proofs = [json.loads(line) for line in runtime_log.splitlines() if line.startswith('{') and '"PASS"' in line]
        require(len(proofs) == 1, 'RUNTIME_RECEIPT_AMBIGUOUS')
        proof = proofs[0]
        validate_runtime(proof)
        stage = 'SAVE_CANDIDATE'
        candidate = runner / ('candidate-table-image-'+args.target+'.tar.gz')
        identity_path = runner / ('candidate-table-image-'+args.target+'.identity.json')
        require(not candidate.exists() and not identity_path.exists(), 'CANDIDATE_EXISTS')
        with candidate.open('xb') as output:
            saved = subprocess.Popen(['docker','save',info['Id']],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
            try:
                compressed = subprocess.run(['gzip','-1'],stdin=saved.stdout,stdout=output,stderr=subprocess.DEVNULL)
            finally:
                saved.stdout.close()
            require(saved.wait() == 0 and compressed.returncode == 0, 'IMAGE_SAVE_FAILED')
        candidate.chmod(0o600)
        digest = sha(candidate)
        identity = {'source_revision':SOURCE,'source_tree':TREE,'architecture':args.target,'candidate_sha256':digest,
                    'image_id':info['Id'],'service_tests':service_count,'core_tests':core_count,'runtime_passed':True}
        identity_path.write_text(json.dumps(identity,indent=2)+'\n',encoding='utf-8')
        identity_path.chmod(0o600)
        run('IMAGE_PRIVACY',['.scanner-venv/bin/python','input-source/security/gate.py','--repo','input-source',
            '--report',str(private/'image-privacy.json'),'image-archive',str(candidate)])
        require(sha(candidate) == digest, 'CANDIDATE_CHANGED')
        report = json.loads((private/'image-privacy.json').read_text())
        require(report.get('status') == 'passed' and report.get('findings') == [], 'IMAGE_PRIVACY_NOT_CLEAR')
        archive = out / ('qualified-table-image-'+args.target+'.tar.gz')
        candidate.replace(archive)
        receipt = {'result':'PASS','source_revision':SOURCE,'source_tree':TREE,'source_offer_id':OFFER,
          'source_archive_sha256':ARCHIVE_SHA,'backend_revision':BACKEND,'controller_commit':os.environ['GITHUB_SHA'],
          'run_id':os.environ['GITHUB_RUN_ID'],'architecture':args.target,'runner_machine':platform.machine(),
          'image_id':info['Id'],'docker_archive':archive.name,'docker_archive_sha256':digest,
          'linux_service_tests':service_count,'linux_core_tests':core_count,'saved_image_privacy':'PASS',
          'production_runtime':proof,'read_only_runtime':True,'network_none_runtime':True,'fresh_catalog_volume':True,
          'worker_memory_bytes':536870912,'runtime_uid':info['Config']['User'],'no_host_ports':True,
          'runtime_smoke_sha256':sha(root/'deploy/table-service/runtime-smoke.mjs'),
          'raw_field_contract_sha256':sha(root/'deploy/table-service/raw-field-contract.mjs')}
        (out/'qualification.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
        # Scan the safe receipt, never upload raw logs/private image reports.
        run('OUTBOUND_RECEIPT',['.scanner-venv/bin/python','input-source/security/gate.py','--repo','input-source',
                               'artifacts',str(out/'qualification.json')])
        print(json.dumps({'result':'PASS','architecture':args.target,'image_sha256':digest}))
        return 0
    except Exception:
        print(json.dumps({'result':'FAILED/BLOCKED','stage':stage}))
        return 1
    finally:
        subprocess.run(['docker','rm','-f',container,service_container,core_container,initializer_container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if volume_created:
            subprocess.run(['docker','volume','rm',volume],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        subprocess.run(['docker','image','rm',image,build],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

if __name__ == '__main__':
    raise SystemExit(main())
