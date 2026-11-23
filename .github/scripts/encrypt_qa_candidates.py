"""Failure-only V4 encrypted QA; reviewed V3 streaming encryption boundary reused."""
import argparse, hashlib, io, json, os, platform, re, shutil, stat, subprocess, sys, tarfile, tempfile, urllib.request
from pathlib import Path
AGE_VERSION='1.3.2'
RECIPIENT='age160m7enkqn7g3gy9sm66keanjfsnkjfs2u6ce57w3jzz8egvm7erq39zaqx'
RECIPIENT_FINGERPRINT='f4d0a6118a8a999208d0283df04268e005b0c3ece0871013ce05af7d84200102'
TARGETS={'mac-arm': {'system': 'Darwin', 'runner_os': 'macOS', 'machine': 'arm64', 'triple': 'aarch64-apple-darwin', 'age_arch': 'darwin-arm64', 'source': '4c96d83fcbda86d5fd4864ed8a07ad86f6b668de', 'auditor': '4c96d83fcbda86d5fd4864ed8a07ad86f6b668de', 'offer': '04191076bf4742f1aa3b69720cbdfe6e30f6c96d5f421b36b39de623d7015d6f', 'files': {'dmg': 'BDOBB_4.0.0_aarch64.dmg', '': 'BDOBB_aarch64.app.tar.gz'}}, 'mac-intel': {'system': 'Darwin', 'runner_os': 'macOS', 'machine': 'x86_64', 'triple': 'x86_64-apple-darwin', 'age_arch': 'darwin-amd64', 'source': '4c96d83fcbda86d5fd4864ed8a07ad86f6b668de', 'auditor': '4c96d83fcbda86d5fd4864ed8a07ad86f6b668de', 'offer': '04191076bf4742f1aa3b69720cbdfe6e30f6c96d5f421b36b39de623d7015d6f', 'files': {'dmg': 'BDOBB_4.0.0_x64.dmg', '': 'BDOBB_x64.app.tar.gz'}}, 'table-amd64': {'system': 'Linux', 'runner_os': 'Linux', 'machine': 'x86_64', 'age_arch': 'linux-amd64', 'source': 'b963af1f9be37a1754b7f568403b8c461c5dbc72', 'auditor': 'b963af1f9be37a1754b7f568403b8c461c5dbc72', 'offer': None, 'files': {'': 'candidate-table-image-amd64.tar.gz'}}}
AGE={'darwin-arm64': {'url': 'https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-darwin-arm64.tar.gz', 'archive_sha256': 'e2020b073c44f692685a24d6abc378817eb81ffaaf49fd0531ef8565f767f2f5', 'archive_size': 18106798, 'binary_sha256': '4012dfc2725883beafb710894af4f599b7a94f8c8e0f51f02cc96ab8df33915e', 'binary_size': 6502258}, 'darwin-amd64': {'url': 'https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-darwin-amd64.tar.gz', 'archive_sha256': '1d1e4bc66e1427edad7739ae7616157de0e79db8b6d2a1497d7d9925fb06a539', 'archive_size': 19376787, 'binary_sha256': '0c2fbcffab91d0af398162a8ed792e096916c8c47c3c400e303904431103f492', 'binary_size': 6978992}, 'linux-amd64': {'url': 'https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-amd64.tar.gz', 'archive_sha256': 'cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10', 'archive_size': 19405817, 'binary_sha256': 'eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c', 'binary_size': 6977014}}
FAILURE_STAGES=('package-scan','native-qualification','evidence-scan','image-privacy')


class RetentionError(Exception):
    """A fixed diagnostic code only; never carry candidate contents or input values."""


def file_hash(path):
    with os.fdopen(os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)), 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise RetentionError('UNSAFE_FILE')
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def physical_directory(path):
    # Reject symlink ancestors too, including an aliased candidate parent.
    for part in [path, *path.parents]:
        if not stat.S_ISDIR(part.lstat().st_mode):
            raise RetentionError('UNSAFE_DIRECTORY')


def regular_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size <= 0:
        raise RetentionError('UNSAFE_FILE')
    return info


def snapshot_candidates(selected, snapshot):
    snapshot.mkdir(mode=0o700)
    records = []
    for source in selected:
        initial = regular_file(source)
        before = file_hash(source)
        destination = snapshot / source.name
        flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
        with os.fdopen(os.open(source, flags), 'rb') as reader:
            opened = os.fstat(reader.fileno())
            if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino, opened.st_size) != (initial.st_dev, initial.st_ino, initial.st_size):
                raise RetentionError('CANDIDATE_CHANGED')
            with destination.open('xb') as writer:
                shutil.copyfileobj(reader, writer, length=1024 * 1024)
        destination.chmod(0o600)
        if destination.stat().st_size != initial.st_size or file_hash(destination) != before or file_hash(source) != before:
            raise RetentionError('CANDIDATE_CHANGED')
        records.append({'filename': source.name, 'size': initial.st_size, 'sha256': before})
    return records


def write_tar(stream, snapshot, records):
    if {path.name for path in snapshot.iterdir()} != {record['filename'] for record in records}:
        raise RetentionError('SNAPSHOT_EXTRAS')
    with tarfile.open(fileobj=stream, mode='w|', format=tarfile.USTAR_FORMAT) as archive:
        for record in sorted(records, key=lambda row: row['filename']):
            path = snapshot / record['filename']
            info = regular_file(path)
            if Path(record['filename']).name != record['filename'] or info.st_size != record['size'] or file_hash(path) != record['sha256']:
                raise RetentionError('SNAPSHOT_CHANGED')
            member = tarfile.TarInfo(record['filename'])
            member.size = record['size']
            member.mode = 0o600
            member.uid = member.gid = member.mtime = 0
            member.uname = member.gname = ''
            with path.open('rb') as payload:
                archive.addfile(member, payload)


def verify_candidates(selected, records):
    expected = {row['filename']: row for row in records}
    if len(expected) != len(records) or {p.name for p in selected} != set(expected):
        raise RetentionError('CANDIDATE_SET_CHANGED')
    for path in selected:
        row = expected[path.name]
        physical_directory(path.parent)
        if regular_file(path).st_size != row['size'] or file_hash(path) != row['sha256']:
            raise RetentionError('CANDIDATE_CHANGED')


def prepare_output(outdir, runner_temp, target):
    physical_directory(runner_temp)
    if outdir != runner_temp / ('v4-encrypted-qa-' + target) or outdir.exists() or outdir.is_symlink():
        raise RetentionError('UNSAFE_OUTPUT_DIRECTORY')
    outdir.mkdir(mode=0o700)


def require_recipient(recipient):
    if recipient != RECIPIENT or hashlib.sha256(recipient.encode('ascii')).hexdigest() != RECIPIENT_FINGERPRINT:
        raise RetentionError('UNREVIEWED_RECIPIENT')


def git_identity(path, expected):
    physical_directory(path)
    process = subprocess.run(['git', '-C', str(path), 'rev-parse', 'HEAD'], capture_output=True, text=True)
    if process.returncode or process.stdout.strip() != expected:
        raise RetentionError('CHECKOUT_IDENTITY_MISMATCH')
    clean = subprocess.run(['git', '-C', str(path), 'diff', '--quiet', 'HEAD', '--'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if clean.returncode:
        raise RetentionError('TRACKED_CHECKOUT_CHANGED')


def install_age(work, target):
    arch = TARGETS[target]['age_arch']
    pin = AGE[arch]
    url = pin['url']
    request = urllib.request.Request(url, headers={'User-Agent': 'V4-encrypted-QA-retention'})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(pin['archive_size'] + 1)
    if len(data) != pin['archive_size'] or hashlib.sha256(data).hexdigest() != pin['archive_sha256']:
        raise RetentionError('AGE_ARCHIVE_HASH_MISMATCH')
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        members = [m for m in archive.getmembers() if m.name == 'age/age']
        if len(members) != 1 or not members[0].isfile() or members[0].size != pin['binary_size']:
            raise RetentionError('AGE_BINARY_MEMBER_MISMATCH')
        binary = archive.extractfile(members[0]).read(pin['binary_size'] + 1)
    if len(binary) != pin['binary_size'] or hashlib.sha256(binary).hexdigest() != pin['binary_sha256']:
        raise RetentionError('AGE_BINARY_HASH_MISMATCH')
    executable = work / 'age'
    executable.write_bytes(binary)
    executable.chmod(0o700)
    version = subprocess.run([str(executable), '--version'], capture_output=True, text=True, timeout=15)
    if version.returncode or version.stdout.strip().lstrip('v') != AGE_VERSION:
        raise RetentionError('AGE_VERSION_MISMATCH')
    return executable


def encrypt_stream(executable, recipient, snapshot, records, output):
    # Exactly one reviewed X25519 recipient, never a private identity or plugin.
    require_recipient(recipient)
    process = subprocess.Popen([str(executable), '-r', recipient, '-o', str(output)], stdin=subprocess.PIPE,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with process.stdin as stream:
            write_tar(stream, snapshot, records)
        if process.wait(timeout=120) != 0:
            raise RetentionError('AGE_ENCRYPTION_FAILED')
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
    regular_file(output)
    with output.open('rb') as stream:
        if stream.read(22) != b'age-encryption.org/v1\n':
            raise RetentionError('AGE_OUTPUT_FORMAT_MISMATCH')


class SafeParser(argparse.ArgumentParser):
    def error(self, _message):
        raise RetentionError('INVALID_ARGUMENTS')


def main(argv=None):
    try:
        parser = SafeParser(description=__doc__, add_help=False)
        parser.add_argument('--target', required=True, choices=TARGETS)
        for name in ['app', 'auditor', 'controller', 'recipient', 'outdir']:
            parser.add_argument('--' + name, required=True)
        parser.add_argument('--failure-stage', required=True, choices=FAILURE_STAGES)
        parser.add_argument('--qualification-outcome', required=True, choices=['failure'])
        args = parser.parse_args(argv)
        require_recipient(args.recipient)
        files = retain(args)
        print(json.dumps({'status': 'QA_ONLY_RETAINED', 'qualification_state': 'FAILED/BLOCKED', 'files': files}))
        return 0
    except Exception as error:
        # Never include exception text, commands, recipient inputs or raw reports.
        code = str(error) if isinstance(error, RetentionError) and re.fullmatch('[A-Z_]+', str(error)) else 'RETENTION_OPERATION_FAILED'
        print(json.dumps({'status': 'QA_RETENTION_FAILED', 'code': code}), file=sys.stderr)
        return 1


def require_hosted_native(target):
    config=TARGETS[target]
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('RUNNER_ENVIRONMENT')!='github-hosted' or os.environ.get('RUNNER_OS')!=config['runner_os'] or platform.system()!=config['system'] or platform.machine()!=config['machine']:
        raise RetentionError('HOSTED_NATIVE_REQUIRED')


def select_candidates(bundle,target):
    physical_directory(bundle)
    wanted=TARGETS[target]['files']
    if target=='table-amd64':
        result=[bundle/wanted['']]
        if len([p for p in bundle.iterdir() if p.name.startswith('candidate-table-image-') and p.name.endswith('.tar.gz')])!=1:
            raise RetentionError('MISSING_OR_AMBIGUOUS_CANDIDATE')
    else:
        selected={name:[] for name in wanted.values()}
        def unreadable(_error):raise RetentionError('UNREADABLE_BUNDLE')
        for directory,subdirs,names in os.walk(bundle,followlinks=False,onerror=unreadable):
            for name in subdirs+names:
                if name.lower().endswith(('.dmg','.app.tar.gz')):
                    if name not in selected:raise RetentionError('EXTRA_INSTALLER')
                    path=Path(directory)/name;regular_file(path);selected[name].append(path)
        result=[]
        for directory,name in wanted.items():
            expected=bundle/directory/name
            if selected[name]!=[expected]:raise RetentionError('MISSING_OR_AMBIGUOUS_INSTALLER')
            result.append(expected)
    for path in result:physical_directory(path.parent);regular_file(path)
    return sorted(result,key=lambda path:path.name)


def image_identity(runner_temp,record):
    path=runner_temp/'candidate-table-image-amd64.identity.json'
    if regular_file(path).st_size>8192:raise RetentionError('INVALID_IMAGE_IDENTITY')
    value=json.loads(path.read_text(encoding='utf-8'))
    if value.get('source_revision')!=TARGETS['table-amd64']['source'] or value.get('source_tree')!='e8b331b5f813defc34cbbbb7aa6b5b5e0f3a3cb2' or value.get('architecture')!='amd64' or value.get('candidate_sha256')!=record['sha256'] or not re.fullmatch('sha256:[0-9a-f]{64}',value.get('image_id','')) or value.get('service_tests')!=79 or value.get('core_tests')!=213 or value.get('runtime_passed') is not True:
        raise RetentionError('INVALID_IMAGE_IDENTITY')
    return {key:value[key] for key in ['source_revision','source_tree','architecture','candidate_sha256','image_id','service_tests','core_tests','runtime_passed']}


def make_receipt(target,records,ciphertext,controller,failure_stage,image=None):
    config=TARGETS[target];pin=AGE[config['age_arch']]
    return {'schema':1,'purpose':'ENCRYPTED QA ONLY; NOT A QUALIFIED ARTIFACT','qualification_state':'FAILED/BLOCKED',
        'failure_stage':failure_stage,'target':target,'source_commit':config['source'],'source_offer_id':config['offer'],
        'auditor_commit':config['auditor'],'controller_commit':controller,'recipient_fingerprint_sha256':RECIPIENT_FINGERPRINT,
        'recipient_type':'single X25519 age recipient; private identity never provided to runner',
        'age':{'version':AGE_VERSION,'architecture':config['age_arch'],**pin},'candidates':records,
        'ciphertext':{'filename':ciphertext.name,'size':ciphertext.stat().st_size,'sha256':file_hash(ciphertext)},'retention_days':1,
        'image_identity':image}


def retain(args):
    require_hosted_native(args.target);require_recipient(args.recipient)
    if args.qualification_outcome!='failure' or args.failure_stage not in FAILURE_STAGES or (args.target=='table-amd64')!=(args.failure_stage=='image-privacy'):
        raise RetentionError('ORIGINAL_FAILURE_REQUIRED')
    controller=os.environ.get('GITHUB_SHA','')
    if not re.fullmatch('[0-9a-f]{40}',controller):raise RetentionError('CONTROLLER_PIN_MISSING')
    config=TARGETS[args.target];app,auditor,control=(Path(value).absolute() for value in [args.app,args.auditor,args.controller])
    git_identity(app,config['source']);git_identity(auditor,config['auditor']);git_identity(control,controller)
    if config['offer'] is not None and json.loads((app/'source-offer.json').read_text(encoding='utf-8'))['sourceId']!=config['offer']:
        raise RetentionError('SOURCE_OFFER_MISMATCH')
    runner_temp=Path(os.environ['RUNNER_TEMP']).absolute()
    bundle=runner_temp if args.target=='table-amd64' else app/'src-tauri/target'/config['triple']/'release/bundle'
    selected=select_candidates(bundle,args.target);outdir=Path(args.outdir).absolute();prepare_output(outdir,runner_temp,args.target)
    cipher_name='qa-blocked-v4-'+args.target+'.tar.age';partial=outdir/(cipher_name+'.partial');ciphertext=outdir/cipher_name;succeeded=False
    try:
        with tempfile.TemporaryDirectory(prefix='v4-qa-private-',dir=runner_temp) as private:
            work=Path(private);records=snapshot_candidates(selected,work/'candidates')
            image=image_identity(runner_temp,records[0]) if args.target=='table-amd64' else None
            executable=install_age(work,args.target);encrypt_stream(executable,args.recipient,work/'candidates',records,partial)
            verify_candidates(selected,records);verify_candidates(list((work/'candidates').iterdir()),records)
            if select_candidates(bundle,args.target)!=selected:raise RetentionError('CANDIDATE_SET_CHANGED')
            if args.target=='table-amd64' and image_identity(runner_temp,records[0])!=image:raise RetentionError('IMAGE_IDENTITY_CHANGED')
            partial.replace(ciphertext);ciphertext.chmod(0o600)
            receipt=make_receipt(args.target,records,ciphertext,controller,args.failure_stage,image)
            manifest=outdir/'retention.json';manifest.write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8',newline='\n');manifest.chmod(0o600)
            if {p.name for p in outdir.iterdir()}!={cipher_name,'retention.json'} or any(not stat.S_ISREG(p.lstat().st_mode) for p in outdir.iterdir()):raise RetentionError('OUTPUT_SET_MISMATCH')
        succeeded=True;return [cipher_name,'retention.json']
    finally:
        if not succeeded:shutil.rmtree(outdir)


if __name__=='__main__':raise SystemExit(main())
