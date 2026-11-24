#!/usr/bin/env python3
"""V4–V6 Mac-only controller preserving reviewed package/runtime boundaries."""
import argparse, hashlib, importlib.util, json, os, platform, plistlib, shutil, signal, struct, re, subprocess, sys, tempfile, time
from pathlib import Path
SUPPORTED_RELEASES=('v4.0.0','v5.0.0','v6.0.0')
BINDING_PATH=Path(__file__).with_name('mac-release-binding.json')
RELEASE_VERSION=VERSION=SOURCE_COMMIT=SOURCE_ID=AUDITOR_COMMIT=None
EXPECTED_OFFER={}
TARGETS={}
BINDING=None

def load_release_binding(release=None,path=None):
    release=release or os.environ.get('BDOBB_RELEASE_VERSION')
    if release not in SUPPORTED_RELEASES: raise ValueError('Unsupported release binding')
    path=Path(path or BINDING_PATH)
    if path.is_symlink() or not path.is_file(): raise ValueError('Missing physical release binding')
    def unique(pairs):
        result=dict(pairs)
        if len(result)!=len(pairs):raise ValueError('Duplicate release binding field')
        return result
    value=json.loads(path.read_text(encoding='utf-8'),object_pairs_hook=unique)
    if not isinstance(value,dict) or set(value)!={'schemaVersion','bindings','retention'} or type(value['schemaVersion']) is not int or value['schemaVersion']!=2:raise ValueError('Invalid release binding schema')
    slots=value['bindings']
    if not isinstance(slots,dict) or set(slots)!=set(SUPPORTED_RELEASES):raise ValueError('Invalid release binding versions')
    fields={'state','productCommit','auditorCommit','baseCommit','sourceId','counts'}
    if any(not isinstance(row,dict) or set(row)!=fields for row in slots.values()):raise ValueError('Invalid release binding fields')
    row=slots[release]
    if row['state']!='FROZEN':raise ValueError('Unfrozen release binding')
    validate_counts(row['counts'])
    for key in ['productCommit','auditorCommit','baseCommit','sourceId']:
        size=64 if key=='sourceId' else 40
        if not isinstance(row[key],str) or not re.fullmatch('[0-9a-f]{'+str(size)+'}',row[key]):raise ValueError('Unfrozen release binding')
    retention=value['retention']
    if not isinstance(retention,dict) or set(retention)!={'publicRecipient','fingerprint'}:raise ValueError('Invalid retention binding')
    recipient=retention['publicRecipient'];fingerprint=retention['fingerprint']
    if not isinstance(recipient,str) or not re.fullmatch('age1[0-9a-z]{58}',recipient) or not isinstance(fingerprint,str) or hashlib.sha256(recipient.encode()).hexdigest()!=fingerprint:raise ValueError('Unfrozen retention binding')
    filename=f"bdobb-{release}-agpl-{row['sourceId'][:12]}-source.tar.gz"
    return {'release':release,'version':release[1:],'product_commit':row['productCommit'],'auditor_commit':row['auditorCommit'],'base_commit':row['baseCommit'],'source_id':row['sourceId'],'archive_filename':filename,'archive_url':f"https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-{release}-{row['sourceId'][:12]}/{filename}",'wasm':True,'counts':row['counts'],'recipient':recipient,'recipient_fingerprint':fingerprint}

def configure_release(binding=None):
    global BINDING,RELEASE_VERSION,VERSION,SOURCE_COMMIT,SOURCE_ID,AUDITOR_COMMIT,EXPECTED_OFFER,TARGETS
    BINDING=binding or load_release_binding();RELEASE_VERSION=BINDING['release'];VERSION=BINDING['version'];SOURCE_COMMIT=BINDING['product_commit'];SOURCE_ID=BINDING['source_id'];AUDITOR_COMMIT=BINDING['auditor_commit']
    EXPECTED_OFFER={'sourceId':SOURCE_ID,'baseCommit':BINDING['base_commit'],'archiveFilename':BINDING['archive_filename'],'archiveUrl':BINDING['archive_url']}
    TARGETS={'mac-arm':('aarch64',[f'BDOBB_{VERSION}_aarch64.dmg','BDOBB_aarch64.app.tar.gz']),'mac-intel':('x86_64',[f'BDOBB_{VERSION}_x64.dmg','BDOBB_x64.app.tar.gz'])}
    return BINDING




def expected_names(target):
    return list(TARGETS[target][1])


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def run(args, **kwargs):
    return subprocess.run(list(map(str, args)), check=True, text=True, **kwargs)


def binary_arch(path):
    with path.open("rb") as stream:
        header = stream.read(64)
        if header[:4] == b"\x7fELF" and header[5] == 1:
            value = struct.unpack_from("<H", header, 18)[0]
        elif header[:4] == b"\xcf\xfa\xed\xfe":
            value = struct.unpack_from("<I", header, 4)[0]
        elif header[:2] == b"MZ":
            stream.seek(struct.unpack_from("<I", header, 60)[0])
            pe = stream.read(6)
            if pe[:4] != b"PE\0\0":
                raise ValueError("Invalid PE executable")
            value = struct.unpack_from("<H", pe, 4)[0]
        else:
            raise ValueError("Unknown native executable header")
    for arch, values in {"aarch64": {183, 0x100000C, 0xAA64}, "x86_64": {62, 0x1000007, 0x8664}}.items():
        if value in values:
            return arch
    raise ValueError("Unexpected executable architecture")


def require_arch(path, expected):
    if binary_arch(path) != expected:
        raise ValueError("Executable architecture does not match native runner")


def require_packages(root, names):
    actual = {p.name for p in root.iterdir() if p.name.startswith("BDOBB")}
    if actual != set(names) or any(not (root / n).is_file() or not (root / n).stat().st_size for n in names):
        raise ValueError("Missing, empty, duplicate, or unexpected installer package")


def verify_offer(frontend):
    # Maps can contain dead source. Require offer values in shipped executable JS.
    for path in frontend.rglob("*.js"):
        text = path.read_text(encoding="utf-8")
        if all(value in text for value in EXPECTED_OFFER.values()):
            return
    raise ValueError("Final executable JavaScript does not embed the exact Mac source offer")


def verify_empty_profile(data):
    backend = data / "backends.json"
    if not backend.is_file() or json.loads(backend.read_text()) != []:
        raise ValueError("Fresh runtime did not persist exactly empty backends")
    settings = data / "settings.json"
    if not settings.is_file():
        raise ValueError("Fresh runtime settings were not persisted")
    config = json.loads(settings.read_text())
    if not isinstance(config, dict) or RELEASE_VERSION not in SUPPORTED_RELEASES:
        raise ValueError("Fresh runtime settings or version binding invalid")
    service_fields = {}
    for key, empty in [("ritaUrl", ""), ("mcpServers", []), ("shareTargets", [])]:
        if key not in config:
            if RELEASE_VERSION not in ["v4.0.0", "v5.0.0"]:
                raise ValueError("Fresh runtime service setting missing")
            service_fields[key] = "ABSENT_NOT_INTRODUCED"
        elif config[key] != empty:
            raise ValueError("Fresh runtime contains Rita, MCP or share configuration")
        else:
            service_fields[key] = "PRESENT_EMPTY"
    workspace = data / "workspace.json"
    if workspace.exists() and json.loads(workspace.read_text()).get("connections") != []:
        raise ValueError("Fresh runtime contains Workspace connections")
    return service_fields


def locate_executable(unpacked, package, work):
    allowed_names = {"bdobb"}
    binaries = [p for p in unpacked.rglob("*") if p.is_file() and p.name.lower() in allowed_names]
    if len(binaries) != 1:
        raise ValueError("Expected exactly one final native executable")
    executable = binaries[0]
    member = str(executable.relative_to(unpacked))
    bundle = executable.parents[2]
    if bundle.name != "BDOBB.app" or not bundle.resolve().is_relative_to(unpacked.resolve()):
        raise ValueError("Unsafe application bundle path")
    for item in [bundle, *bundle.rglob("*")]:
        if not item.resolve().is_relative_to(bundle.resolve()):
            raise ValueError("Application member escapes bundle")
    return executable, member


def load_release_gate(app):
    spec = importlib.util.spec_from_file_location("app_release_gate", app / "scripts/public-release.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def collect(app, target, auditor=None):
    root = app / "src-tauri/target" / os.environ["BDOBB_RUST_TARGET"] / "release/bundle"
    names = expected_names(target)
    found = []
    for name in names:
        if name.endswith(".app.tar.gz"):
            continue
        matches = list(root.rglob(name))
        if len(matches) != 1:
            raise ValueError(f"Expected one build output: {name}")
        found.append(matches[0])
    if target.startswith("mac-"):
        # Tauri can remove the intermediate .app after making the DMG.
        with tempfile.TemporaryDirectory(prefix="mac-archive-") as temp:
            unpacked = Path(temp)
            load_release_gate(app).unpack(found[0], unpacked)
            bundles = list(unpacked.rglob("BDOBB.app"))
            if len(bundles) != 1:
                raise ValueError("Expected one app in exact final DMG")
            archive = root / names[1]
            run(["tar", "-czf", archive, "-C", bundles[0].parent, bundles[0].name])
            found.append(archive)
    env = os.environ.copy()
    env["BDOBB_ARTIFACT_PATHS"] = json.dumps(list(map(str, found)))
    run([scanner_python(), (auditor or app) / "scripts/public-release.py", "stage"], cwd=app, env=env)
    require_packages(app / "release-stage", names)


def native_runtime(executable, package, work, evidence, expected_arch):
    home = work / "home"
    home.mkdir()
    env = os.environ.copy()
    env.update(HOME=str(home), CFFIXED_USER_HOME=str(home), XDG_DATA_HOME=str(home / ".local/share"), XDG_CONFIG_HOME=str(home / ".config"), XDG_CACHE_HOME=str(home / ".cache"))
    system = platform.system()
    if system != "Darwin": raise ValueError("Mac-only native runtime")
    data = home / "Library/Application Support/com.artcashin.bdobb"
    profile = work / "profile.sb"
    # Only an ephemeral Actions runner is allowed. Never run on a workstation.
    protected = Path.home() / "Library"
    profile.write_text('(version 1)\n(allow default)\n' + ''.join(f'(deny file-read* file-write* (subpath "{protected / part}"))\n' for part in ["Application Support", "Caches", "Preferences", "WebKit", "HTTPStorages", "Saved Application State", "Logs"]))
    probe = work / "pathprobe.m"
    probe.write_text('#import <Foundation/Foundation.h>\nint main(){@autoreleasepool{puts([NSHomeDirectory() UTF8String]);}return 0;}\n')
    run(["clang", "-framework", "Foundation", probe, "-o", work / "pathprobe"], capture_output=True)
    result = run(["sandbox-exec", "-f", profile, work / "pathprobe"], env=env, capture_output=True)
    if result.stdout.strip() != str(home):
        raise ValueError("Foundation fresh-profile preflight failed")
    command = ["sandbox-exec", "-f", profile, executable]
    if data.exists():
        raise ValueError("Native data directory existed before launch; refusing to read or reset it")
    if (data.parent / "com.artcashin.bdobb.clean.v3.repair").exists():
        raise ValueError("Migration profile exists before launch; refusing to read it")
    receipt = {"method": "exact package extraction and native executable launch; installer UI/system registration not exercised", "data_preflight_absent": True, "expected_arch": expected_arch, "host_arch": platform.machine(), "data_directory": str(data), "displayed_about": {"status": "NOT_OBSERVED", "scope": "package metadata is recorded separately"}}
    process = None
    try:
        with (evidence / "runtime.log").open("w") as log:
            process = subprocess.Popen(list(map(str, command)), env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            deadline = time.monotonic() + 60
            while not all((data / name).is_file() for name in ["backends.json", "settings.json"]):
                if process.poll() is not None:
                    raise ValueError("Native app exited before seeding a fresh profile")
                if time.monotonic() >= deadline:
                    raise ValueError("Native app did not seed a fresh profile within 60 seconds")
                time.sleep(0.5)
            verify_empty_profile(data)
            time.sleep(3)
            if process.poll() is not None:
                raise ValueError("Native app exited during startup smoke")
            receipt["pid"] = process.pid
            verify_empty_profile(data)
            receipt["backends"] = []
            receipt["service_configuration_fields"] = verify_empty_profile(data)
            # Pre-V6 versions do not persist these future service settings.
            # Only record a value when it was actually present and verified empty.
            for key, empty in [("ritaUrl", ""), ("mcpServers", []), ("shareTargets", [])]:
                if receipt["service_configuration_fields"][key] == "PRESENT_EMPTY":
                    receipt[key] = empty
            if system == "Darwin":
                run(["sample", process.pid, "1", "1", "-file", evidence / "native-process.txt"], capture_output=True)
                sample = (evidence / "native-process.txt").read_text()
                line = next((x.strip() for x in sample.splitlines() if "Code Type:" in x), "")
                actual_code_type = "aarch64" if "ARM64" in line or "ARM-64" in line else "x86_64" if "X86-64" in line else None
                if "Translated" in line or actual_code_type != expected_arch:
                    raise ValueError("Native process architecture proof failed")
                receipt["native_process_code_type"] = line
                from types import SimpleNamespace
                probe_spec = importlib.util.spec_from_file_location("v4_mac_about_probe", Path(__file__).with_name("mac_about_probe.py"))
                probe = importlib.util.module_from_spec(probe_spec)
                probe_spec.loader.exec_module(probe)
                observation = probe.observe(SimpleNamespace(pid=process.pid, executable=str(executable), sha256=sha256(executable),
                                                         expected_arch=expected_arch, evidence_dir=str(evidence), temp_dir=str(work)), binding=BINDING)
                receipt["displayed_about"] = observation
                if observation["status"] != "OBSERVED_VERSION_MATCH":
                    raise ValueError("Owned native About observer rejected application identity or displayed version")
            receipt["displayed_version_observed"] = receipt["displayed_about"].get("status") == "OBSERVED_VERSION_MATCH"
            receipt["status"] = "PASS"
            return receipt
    finally:
        if process is not None:
            from owned_process import cleanup_owned_group
            try:
                receipt['owned_process_cleanup'] = cleanup_owned_group(process)
            except BaseException:
                (work/'.owned-tree-unconfirmed').write_text('GAP_OWNED_TREE_TEARDOWN_UNCONFIRMED\n')
                raise
            print(json.dumps({'native_phase':'OWNED_APP_CLEANUP_COMPLETED','process_exit_code':process.poll()}),flush=True)



def qualify(app, target, auditor=None):
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
        raise ValueError("Runtime smoke is restricted to ephemeral GitHub-hosted runners")
    if platform.system() != "Darwin": raise ValueError("Mac-only native qualification")
    expected_arch = TARGETS[target][0]
    host_arch = {"arm64": "aarch64", "AMD64": "x86_64"}.get(platform.machine(), platform.machine())
    if host_arch != expected_arch:
        raise ValueError("Runner must natively match target architecture")
    if run(["git", "rev-parse", "HEAD"], cwd=app, capture_output=True).stdout.strip() != SOURCE_COMMIT:
        raise ValueError("App checkout is not pinned final Mac source")
    gate = load_release_gate(auditor or app)
    stage = app / "release-stage"
    require_packages(stage, expected_names(target))
    if json.loads((app / "source-offer.json").read_text())["sourceId"] != SOURCE_ID:
        raise ValueError("App source-offer identity mismatch")
    if json.loads((app / "src-tauri/tauri.conf.json").read_text())["version"] != VERSION:
        raise ValueError("Tauri source version mismatch")
    counts = verify_source_evidence(app, BINDING)
    records = {}
    scans = json.loads((stage / "scan.json").read_text())
    for name in expected_names(target):
        package = stage / name
        digest = sha256(package)
        if scans.get(name, {}).get("sha256") != digest:
            raise ValueError("Package changed after app-owned final scanner")
        evidence = app / "qualification-evidence" / name
        evidence.mkdir(parents=True)
        from owned_process import private_workspace
        with private_workspace(os.environ["RUNNER_TEMP"],prefix="mac-runtime-") as temp:
            work = Path(temp)
            unpacked = work / "unpacked"
            unpacked.mkdir()
            gate.unpack(package, unpacked)
            executable, member = locate_executable(unpacked, package, work)
            require_arch(executable, expected_arch)
            original_executable_sha = sha256(executable)
            installed_bundle = work / "Applications/BDOBB.app"
            installed_bundle.parent.mkdir()
            run(["ditto", executable.parents[2], installed_bundle], capture_output=True)
            executable = installed_bundle / "Contents/MacOS" / executable.name
            if sha256(executable) != original_executable_sha:
                raise ValueError("Installed app copy differs from exact scanned executable")
            require_arch(executable, expected_arch)
            frontend = work / "frontend"
            run(["tauri-dumper", "extract", executable, "-o", frontend, "--json"], capture_output=True)
            gate.check_frontend(frontend)
            verify_offer(frontend)
            record = {"sha256": digest, "source_commit": SOURCE_COMMIT, "source_id": SOURCE_ID, "release":RELEASE_VERSION, "embedded_offer": EXPECTED_OFFER, "embedded_defaults": "all eight exact empty values verified by app checker", "executable_sha256": sha256(executable), "architecture": expected_arch, "test_counts":counts}
            if auditor is not None:
                record["auditor_commit"] = run(["git", "rev-parse", "HEAD"], cwd=auditor, capture_output=True).stdout.strip()
            record["extracted_executable_member"] = member
            record["launch_executable_name"] = executable.name
            if platform.system() == "Darwin":
                bundle = executable.parents[2]
                meta = plistlib.loads((bundle / "Contents/Info.plist").read_bytes())
                if meta.get("CFBundleShortVersionString") != VERSION or meta.get("CFBundleIdentifier") != "com.artcashin.bdobb":
                    raise ValueError("Installed macOS bundle identity/version mismatch")
                result = run(["codesign", "--verify", "--deep", "--strict", bundle], capture_output=True)
                record["signature"] = "valid ad hoc; no Developer ID/notarization/Gatekeeper claim"
            record["installation"] = {"method":"ditto app-copy from exact package into private runner Applications directory", "bundle_version":meta["CFBundleShortVersionString"], "installed_executable_sha256":sha256(executable)}
            record["runtime"] = native_runtime(executable, package, work, evidence, expected_arch)
            record["runtime"]["method"] = "Actual privately installed app-copy executable; no global LaunchServices registration or installer dialog claim"
            if record['runtime'].get('status')!='PASS' or record['runtime'].get('displayed_version_observed') is not True or record['runtime'].get('displayed_about',{}).get('status')!='OBSERVED_VERSION_MATCH' or record['runtime'].get('owned_process_cleanup') is not True:
                raise ValueError('Native runtime or owned process cleanup evidence missing')
            if sha256(executable) != original_executable_sha:
                raise ValueError("Installed executable changed during native runtime qualification")
            shutil.rmtree(installed_bundle)
            if installed_bundle.exists(): raise ValueError("Private installed app-copy cleanup failed")
            record["cleanup"] = {"installed_bundle_absent":True}

            if sha256(package) != digest:
                raise ValueError("Package changed during runtime qualification")
            records[name] = record
    (stage / "qualification.json").write_text(json.dumps(records, indent=2) + "\n")
    (stage / "SHA256SUMS").write_text("".join(f"{r['sha256']}  {n}\n" for n, r in sorted(records.items())))


def aggregate(root):
    expected = {name for target in TARGETS for name in expected_names(target)}
    result = {}
    for manifest in root.rglob("qualification.json"):
        records = json.loads(manifest.read_text())
        for name, record in records.items():
            if name not in expected or name in result or Path(name).name != name:
                raise ValueError("Duplicate, unexpected, or unsafe artifact in qualification manifests")
            path = manifest.parent / name
            if not path.is_file() or sha256(path) != record["sha256"]:
                raise ValueError("Downloaded installer digest does not match scanned qualification")
            if record.get("embedded_offer") != EXPECTED_OFFER or record.get("release") != RELEASE_VERSION or record.get("auditor_commit") != AUDITOR_COMMIT or record.get("source_commit") != SOURCE_COMMIT or record.get("source_id") != SOURCE_ID or record.get("runtime", {}).get("status") != "PASS" or record.get("runtime", {}).get("displayed_version_observed") is not True or record.get("runtime", {}).get("displayed_about", {}).get("status") != "OBSERVED_VERSION_MATCH":
                raise ValueError("Installer source identity or runtime qualification missing")
            if record.get('test_counts')!=source_test_receipt(BINDING['counts']) or record.get('runtime',{}).get('owned_process_cleanup') is not True:
                raise ValueError('Structured source controls or owned group teardown missing')
            target='mac-arm' if name in expected_names('mac-arm') else 'mac-intel'
            if record.get('architecture')!=TARGETS[target][0] or record.get('runtime',{}).get('expected_arch')!=TARGETS[target][0] or record.get('runtime',{}).get('displayed_about',{}).get('native_architecture')!=TARGETS[target][0]:
                raise ValueError('Native architecture receipt missing')
            if record.get("cleanup", {}).get("installed_bundle_absent") is not True or record.get("installation", {}).get("bundle_version") != VERSION:
                raise ValueError("Actual app-copy installation and cleanup evidence missing")
            result[name] = record
    if set(result) != expected:
        raise ValueError("Expected all four original Mac Mac installers")
    return result



def require(value):
    if not value:raise ValueError('Mac source control refused')

def validate_counts(counts):
    require(isinstance(counts,dict) and set(counts)=={'frontend','source_offer','pending','required_names','skipped_names'})
    require(type(counts['frontend']) is int and counts['frontend']>0 and counts['source_offer']==26 and type(counts['pending']) is int and counts['pending']>=0)
    for key in ['required_names','skipped_names']:
        names=counts[key];require(isinstance(names,list) and len(set(names))==len(names) and all(isinstance(n,str) and 0<len(n)<=1024 and '\n' not in n for n in names))
    require(len(counts['required_names'])==2 and len(counts['skipped_names'])==counts['pending'] and not set(counts['required_names']) & set(counts['skipped_names']))

def source_test_receipt(counts):
    validate_counts(counts)
    return {**counts,'nonpassed_tests':[{'full_name':name,'status':'skipped'} for name in sorted(counts['skipped_names'])]}

def verify_source_results(results,counts):
    validate_counts(counts)
    require(isinstance(results,dict) and type(results.get('numPassedTests')) is int and results['numPassedTests']==counts['frontend'] and results.get('numFailedTests')==0 and type(results.get('numPendingTests')) is int and results['numPendingTests']==counts['pending'])
    suites=results.get('testResults');require(isinstance(suites,list) and all(isinstance(s,dict) and isinstance(s.get('assertionResults'),list) for s in suites))
    rows=[row for suite in suites for row in suite['assertionResults']]
    require(all(isinstance(row,dict) and isinstance(row.get('fullName'),str) and row.get('status') in ['passed','skipped'] for row in rows))
    require(sum(row['status']=='passed' for row in rows)==counts['frontend'])
    for name in counts['required_names']:
        matches=[row for row in rows if row['fullName']==name];require(len(matches)==1 and matches[0]['status']=='passed')
    nonpassed=[{'full_name':row['fullName'],'status':row['status']} for row in rows if row['status']!='passed']
    receipt=source_test_receipt(counts);require(sorted(nonpassed,key=lambda row:row['full_name'])==receipt['nonpassed_tests']);return receipt

def verify_source_offer_log(log,expected):
    for label,count in [('tests',expected),('pass',expected),('fail',0),('cancelled',0),('skipped',0),('todo',0)]:
        matches=re.findall(r'^# '+label+r' (\d+)\s*$',log,re.M);require(len(matches)==1 and int(matches[0])==count)

def verify_source_evidence(app,binding):
    evidence=app/'qualification-evidence';counts=binding['counts']
    logs={}
    for name in ['source-offer','frontend']:
        path=evidence/(name+'-tests.log');require(path.is_file() and not path.is_symlink() and 0<path.stat().st_size<=TEST_LOG_LIMIT);logs[name]=path.read_text()
    verify_source_offer_log(logs['source-offer'],counts['source_offer'])
    results=evidence/'frontend-results.json';require(results.is_file() and not results.is_symlink() and 0<results.stat().st_size<=FRONTEND_RESULTS_LIMIT)
    receipt=verify_source_results(json.loads(results.read_text()),counts)
    summary=re.findall(r'\bTests\s+(\d+) passed',re.sub(r'\x1b\[[0-9;]*m','',logs['frontend']));require(len(summary)==1 and int(summary[0])==counts['frontend'])
    return receipt

def test_product(app,binding,target):
    require(target in TARGETS);evidence=app/'qualification-evidence';counts=binding['counts'];validate_counts(counts)
    for name,args,kind,expected,names in [('source-offer',['node','--test','scripts/source-offer.check.mjs'],'source_offer',counts['source_offer'],[]),('frontend',['pnpm','test:run','--reporter=verbose','--reporter=json','--outputFile=qualification-evidence/frontend-results.json'],'frontend',counts['frontend'],counts['required_names'])]:
        path=evidence/(name+'-tests.log');result_path=evidence/'frontend-results.json';result=None;results=None;reason='PROCESS_START'
        if kind=='frontend' and target=='mac-intel':args+=['--maxWorkers=1']
        try:
            with path.open('x') as out:result=subprocess.run(args,cwd=app,stdout=out,stderr=subprocess.STDOUT,timeout=1800)
            if kind=='frontend':
                reason='RESULTS_MISSING';require(result_path.is_file() and not result_path.is_symlink())
                reason='RESULTS_LIMIT';require(result_path.stat().st_size<=FRONTEND_RESULTS_LIMIT)
                reason='RESULTS_INVALID';results=json.loads(result_path.read_text())
            reason='PROCESS_EXIT';require(result.returncode==0)
            reason='LOG_LIMIT';require(path.stat().st_size<=TEST_LOG_LIMIT)
            reason='COUNT_OR_REQUIRED_CONTROL'
            if kind=='frontend':
                verify_source_results(results,counts)
                summary=re.findall(r'\bTests\s+(\d+) passed',re.sub(r'\x1b\[[0-9;]*m','',path.read_text()));require(len(summary)==1 and int(summary[0])==expected)
            else:verify_source_offer_log(path.read_text(),expected)
        except Exception as error:
            if isinstance(error,subprocess.TimeoutExpired):reason='SUBPROCESS_TIMEOUT'
            emit_test_refusal(evidence,test_refusal_diagnostic(kind,reason,path,result_path,expected,names,result,results))
            raise
    receipt=verify_source_evidence(app,binding)
    (evidence/'test-counts.json').write_text(json.dumps(receipt,indent=2)+'\n')

def scanner_python():
 temp=Path(os.environ['RUNNER_TEMP']).resolve(strict=True);venv=temp/'mac-scanner';candidate=Path(os.environ['SCANNER_PY']);expected=venv/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
 require(candidate.is_file() and candidate.name==expected.name and candidate.parent.resolve()==expected.parent.resolve() and not expected.parent.is_symlink() and venv.is_dir() and not venv.is_symlink() and (venv/'pyvenv.cfg').is_file() and not (venv/'pyvenv.cfg').is_symlink())
 checked=subprocess.run([str(candidate),'-I','-c','import json,sys,PIL;print(json.dumps([sys.prefix,PIL.__version__,list(sys.version_info[:2])]))'],capture_output=True,text=True,timeout=15)
 require(checked.returncode==0 and len(checked.stdout)<=2048);prefix,pillow,version=json.loads(checked.stdout);require(Path(prefix).resolve()==venv and pillow=='13.0.0' and version==[3,12]);return candidate


TEST_LOG_LIMIT = 8*1024*1024
FRONTEND_RESULTS_LIMIT = 16*1024*1024
TEST_REFUSAL_LIMIT = 8192
TEST_REFUSAL_REASONS = {'PROCESS_START','SUBPROCESS_TIMEOUT','RESULTS_MISSING','RESULTS_LIMIT','RESULTS_INVALID','PROCESS_EXIT','LOG_LIMIT','COUNT_OR_REQUIRED_CONTROL'}
TEST_REFUSAL_FIELDS = {'schema','status','phase','reason','exit_code','log_bytes','result_bytes','expected_passed','actual_passed','actual_failed','actual_pending','summary_matches','summary_passed','required_control_refusal_count','required_control_refusal_sha256','failed_tests'}

def failure_kind(messages):
 if not isinstance(messages,list):return 'OTHER'
 text='\n'.join(message.lower() for message in messages if isinstance(message,str))
 for needle,kind in [('test timed out','TEST_TIMEOUT'),('unable to find','DOM_QUERY'),('tobeenabled','BUTTON_DISABLED'),('assertionerror','ASSERTION')]:
  if needle in text:return kind
 return 'OTHER'

def validate_test_refusal(value):
 require(isinstance(value,dict) and set(value)==TEST_REFUSAL_FIELDS and value['schema']==3 and value['status']=='REFUSED_TEST_GATE')
 require(value['phase'] in {'frontend','source_offer'} and value['reason'] in TEST_REFUSAL_REASONS)
 for key in ['expected_passed','actual_passed','actual_failed','actual_pending','summary_matches','summary_passed','required_control_refusal_count']:
  require(value[key] is None or type(value[key]) is int and 0<=value[key]<=1000000)
 for key in ['log_bytes','result_bytes']:
  require(value[key] is None or type(value[key]) is int and 0<=value[key]<=2**63-1)
 require(value['exit_code'] is None or type(value['exit_code']) is int and -2**31<=value['exit_code']<=2**32-1)
 hashes=value['required_control_refusal_sha256'];require(isinstance(hashes,list) and len(hashes)<=16 and all(isinstance(h,str) and re.fullmatch('[0-9a-f]{64}',h) for h in hashes))
 failures=value['failed_tests'];require(isinstance(failures,list) and len(failures)<=16)
 for row in failures:
  require(isinstance(row,dict) and set(row)=={'full_name_sha256','duration_ms','timeout_reported','failure_kind'})
  require(isinstance(row['full_name_sha256'],str) and re.fullmatch('[0-9a-f]{64}',row['full_name_sha256']))
  require(row['duration_ms'] is None or type(row['duration_ms']) in [int,float] and 0<=row['duration_ms']<=1800000)
  require(type(row['timeout_reported']) is bool and isinstance(row['failure_kind'],str) and row['failure_kind'] in {'OTHER','TEST_TIMEOUT','DOM_QUERY','BUTTON_DISABLED','ASSERTION'})
 return value

def test_refusal_diagnostic(kind,reason,path,result_path,expected,names,process,results):
 def metric(value):return value if type(value) is int and 0<=value<=1000000 else None
 def size(file):
  try:return min(file.stat().st_size,2**63-1) if file.is_file() and not file.is_symlink() else None
  except OSError:return None
 log_bytes=size(path);text=''
 if log_bytes is not None and log_bytes<=TEST_LOG_LIMIT:
  try:text=re.sub(r'\x1b\[[0-9;]*m','',path.read_text(errors='replace'))
  except OSError:pass
 matches=re.findall(r'\bTests\s+(\d+) passed',text) if kind=='frontend' else re.findall(r'^# tests (\d+)\s*$',text,re.M)
 def count(value):return metric(int(value)) if len(value)<=7 else None
 actual={key:None for key in ['passed','failed','pending']};bad=[];failures=[]
 if isinstance(results,dict):
  actual={key:metric(results.get(field)) for key,field in [('passed','numPassedTests'),('failed','numFailedTests'),('pending','numPendingTests')]}
  suites=results.get('testResults',[]);rows=[row for suite in suites if isinstance(suite,dict) for row in suite.get('assertionResults',[]) if isinstance(row,dict)] if isinstance(suites,list) and all(not isinstance(s,dict) or isinstance(s.get('assertionResults',[]),list) for s in suites) else []
  for name in names:
   controls=[row for row in rows if row.get('fullName')==name]
   if len(controls)!=1 or controls[0].get('status')!='passed':bad.append(hashlib.sha256(name.encode()).hexdigest())
  for row in rows:
   if row.get('status')!='failed' or not isinstance(row.get('fullName'),str):continue
   duration=row.get('duration');messages=row.get('failureMessages',[])
   failures.append({'full_name_sha256':hashlib.sha256(row['fullName'].encode()).hexdigest(),'duration_ms':duration if type(duration) in [int,float] and 0<=duration<=1800000 else None,'timeout_reported':isinstance(messages,list) and any(isinstance(message,str) and 'test timed out' in message.lower() for message in messages),'failure_kind':failure_kind(messages)})
 elif kind=='frontend':bad=[hashlib.sha256(name.encode()).hexdigest() for name in names]
 if kind=='source_offer':
  for key,label in [('passed','pass'),('failed','fail'),('pending','skipped')]:
   found=re.findall(r'^# '+label+r' (\d+)\s*$',text,re.M);actual[key]=count(found[0]) if len(found)==1 else None
 exit_code=getattr(process,'returncode',None)
 if type(exit_code) is not int or not -2**31<=exit_code<=2**32-1:exit_code=None
 return validate_test_refusal({'schema':3,'status':'REFUSED_TEST_GATE','phase':kind,'reason':reason,'exit_code':exit_code,'log_bytes':log_bytes,'result_bytes':size(result_path) if kind=='frontend' else None,'expected_passed':metric(expected),'actual_passed':actual['passed'],'actual_failed':actual['failed'],'actual_pending':actual['pending'],'summary_matches':metric(len(matches)),'summary_passed':count(matches[0]) if len(matches)==1 else None,'required_control_refusal_count':metric(len(bad)),'required_control_refusal_sha256':sorted(set(bad))[:16],'failed_tests':sorted(failures,key=lambda row:row['full_name_sha256'])[:16]})

def emit_test_refusal(evidence,diagnostic):
 raw=json.dumps(validate_test_refusal(diagnostic),sort_keys=True,separators=(',',':'))+'\n';require(len(raw.encode())<=TEST_REFUSAL_LIMIT)
 try:
  with (evidence/'test-refusal.json').open('x') as out:out.write(raw)
 except OSError:pass
 print(raw,end='',flush=True)


def main():
    configure_release()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["tests", "collect", "qualify", "aggregate"])
    parser.add_argument("--app", type=Path, default=Path.cwd())
    parser.add_argument("--auditor", type=Path)
    parser.add_argument("--target", choices=TARGETS)
    parser.add_argument("--root", type=Path)
    args = parser.parse_args()
    if args.mode == "tests":
        test_product(args.app.resolve(), BINDING, args.target)
    elif args.mode == "collect":
        collect(args.app.resolve(), args.target, args.auditor.resolve() if args.auditor else None)
    elif args.mode == "qualify":
        qualify(args.app.resolve(), args.target, args.auditor.resolve() if args.auditor else None)
    else:
        records = aggregate(args.root)
        output = Path("qualification-mac4")
        output.mkdir()
        (output / "qualification.json").write_text(json.dumps(records, indent=2) + "\n")
        (output / "SHA256SUMS").write_text("".join(f"{r['sha256']}  {n}\n" for n, r in sorted(records.items())))
        print("Verified all 4 exact original Mac Mac installers and native-runtime receipts")

if __name__=="__main__":main()
