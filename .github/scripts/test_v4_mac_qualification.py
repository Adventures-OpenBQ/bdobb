import importlib.util, json, os, plistlib, shutil, struct, subprocess, tempfile, unittest
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('qualification',Path(__file__).with_name('v4_mac_qualification.py'))
q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)

# Synthetic retention fixtures only; never the active release binding or identity.
PUBLIC_RECIPIENT='age160m7enkqn7g3gy9sm66keanjfsnkjfs2u6ce57w3jzz8egvm7erq39zaqx'
def binding_manifest():
    import hashlib
    return {'schemaVersion':1,'bindings':{v:{'productCommit':str(i)*40,'auditorCommit':str(i)*40,'baseCommit':str(i+6)*40,'sourceId':str(i)*64} for i,v in enumerate(['v3.0.0','v4.0.0','v5.0.0'],1)},'retention':{'publicRecipient':PUBLIC_RECIPIENT,'fingerprint':hashlib.sha256(PUBLIC_RECIPIENT.encode()).hexdigest()}}
def binding_fixture(release):
    with tempfile.TemporaryDirectory() as d:
        path=Path(d)/'binding.json';path.write_text(json.dumps(binding_manifest()))
        return q.load_release_binding(release,path)
class ReleaseBindingTests(unittest.TestCase):
    def require_loader(self):
        self.assertTrue(callable(getattr(q,'load_release_binding',None)),'Reviewed helpers must share a strict release binding before any native work')
    def test_three_exact_versions_and_derived_org_offer(self):
        self.require_loader()
        for release in ['v3.0.0','v4.0.0','v5.0.0']:
            b=binding_fixture(release);self.assertEqual(b['release'],release);self.assertEqual(b['wasm'],release!='v3.0.0')
            self.assertTrue(b['archive_url'].startswith('https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-'+release+'-'))
    def reject(self,change,release='v5.0.0'):
        self.require_loader();value=binding_manifest();change(value)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'binding.json';p.write_text(json.dumps(value))
            with self.assertRaises(ValueError):q.load_release_binding(release,p)
    def test_null_slots_fail_closed(self):self.reject(lambda v:v['bindings']['v5.0.0'].update(productCommit=None))
    def test_wrong_source_commit_refused(self):self.reject(lambda v:v['bindings']['v5.0.0'].update(productCommit='main'))
    def test_unknown_url_or_repository_override_refused(self):self.reject(lambda v:v['bindings']['v5.0.0'].update(repository='artcashin/bdobb'))
    def test_wrong_recipient_fingerprint_refused(self):self.reject(lambda v:v['retention'].update(fingerprint='0'*64))
    def test_unsupported_release_refused(self):self.reject(lambda v:None,'v7.0.0')
    def test_duplicate_json_field_refused(self):
        self.require_loader()
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'binding.json';p.write_text('{"schemaVersion":1,"schemaVersion":1}')
            with self.assertRaises(ValueError):q.load_release_binding('v5.0.0',p)

    def test_actual_workflow_plan_resolves_each_binding_without_builds(self):
        import textwrap
        workflow=Path(__file__).parents[1]/'workflows/v4-table-amd64-qualification.yml'
        script=textwrap.dedent(workflow.read_text().split("python3 - <<'PYTHON'",1)[1].split('          PYTHON',1)[0])
        for release in q.SUPPORTED_RELEASES:
            with tempfile.TemporaryDirectory() as d:
                root=Path(d);scripts=root/'controller/.github/scripts';scripts.mkdir(parents=True)
                shutil.copyfile(Path(q.__file__),scripts/'v4_mac_qualification.py');(scripts/'mac-release-binding.json').write_text(json.dumps(binding_manifest()))
                output=root/'output';env={**os.environ,'SELECTED_TARGET':'all','BDOBB_RELEASE_VERSION':release,'GITHUB_OUTPUT':str(output)}
                process=subprocess.run([__import__('sys').executable,'-c',script],cwd=root,env=env,capture_output=True,text=True)
                self.assertEqual(process.returncode,0,process.stderr)
                values=dict(line.split('=',1) for line in output.read_text().splitlines());self.assertEqual(len(json.loads(values['matrix'])['include']),2);self.assertEqual(values['source'],binding_fixture(release)['product_commit'])

    def test_committed_binding_has_explicit_freeze_state(self):
        value=json.loads(q.BINDING_PATH.read_text())
        for release in q.SUPPORTED_RELEASES:
            ready=all(value['bindings'][release].values()) and all(value['retention'].values())
            with self.subTest(release=release):
                if ready:self.assertEqual(q.load_release_binding(release)['release'],release)
                else:
                    with self.assertRaises(ValueError):q.load_release_binding(release)

class QualificationTest(unittest.TestCase):
    RELEASE='v4.0.0'
    def setUp(self):
        self.binding=binding_fixture(self.RELEASE);q.configure_release(self.binding)
    def test_only_four_original_mac_names_and_selected_offer(self):
        self.assertEqual(set(q.TARGETS),{'mac-arm','mac-intel'})
        self.assertEqual({name for target in q.TARGETS for name in q.expected_names(target)}, {f'BDOBB_{q.VERSION}_aarch64.dmg',f'BDOBB_{q.VERSION}_x64.dmg','BDOBB_aarch64.app.tar.gz','BDOBB_x64.app.tar.gz'})
        self.assertEqual(q.SOURCE_COMMIT,self.binding['product_commit'])
        self.assertEqual(q.SOURCE_ID,self.binding['source_id'])
    def test_native_mach_architectures_refuse_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'bdobb'
            for arch,cpu in [('aarch64',0x100000C),('x86_64',0x1000007)]:
                header=bytearray(64);header[:4]=b'\xcf\xfa\xed\xfe';struct.pack_into('<I',header,4,cpu);path.write_bytes(header)
                q.require_arch(path,arch)
                with self.assertRaises(ValueError):q.require_arch(path,'x86_64' if arch=='aarch64' else 'aarch64')

    def test_missing_or_extra_package_blocks(self):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d)
                names = q.expected_names('mac-intel')
                for n in names:
                    (root / n).write_bytes(b'package')
                q.require_packages(root, names)
                (root / names[0]).unlink()
                with self.assertRaises(ValueError):
                    q.require_packages(root, names)
                (root / names[0]).write_bytes(b'package')
                (root / 'BDOBB_other.dmg').write_bytes(b'x')
                with self.assertRaises(ValueError):
                    q.require_packages(root, names)

    def test_embedded_offer_requires_runtime_javascript(self):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d)
                (root / 'assets').mkdir()
                text = json.dumps(q.EXPECTED_OFFER)
                (root / 'assets/main.js.map').write_text(text)
                with self.assertRaises(ValueError):
                    q.verify_offer(root)
                (root / 'assets/main.js').write_text(text)
                q.verify_offer(root)
                (root / 'assets/main.js').write_text(text.replace(q.SOURCE_ID, 'f' * 64))
                with self.assertRaises(ValueError):
                    q.verify_offer(root)

    def test_nonempty_or_missing_runtime_backend_blocks(self):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d)
                with self.assertRaises(ValueError):
                    q.verify_empty_profile(root)
                (root / 'backends.json').write_text('[]')
                q.verify_empty_profile(root)
                (root / 'workspace.json').write_text('{"connections":[{"id":"unexpected"}]}')
                with self.assertRaises(ValueError):
                    q.verify_empty_profile(root)
                (root / 'workspace.json').unlink()
                (root / 'backends.json').write_text('[{"name":"unexpected"}]')
                with self.assertRaises(ValueError):
                    q.verify_empty_profile(root)

    def test_changed_checksum_blocks_aggregation(self):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d)
                records = {}
                for t in q.TARGETS:
                    out = root / t
                    out.mkdir()
                    manifest = {}
                    for n in q.expected_names(t):
                        p = out / n
                        p.write_bytes(n.encode())
                        manifest[n] = {'sha256': q.sha256(p), 'runtime': {'status': 'PASS'}, 'installation':{'bundle_version':q.VERSION}, 'cleanup':{'installed_bundle_absent':True}, 'source_commit': q.SOURCE_COMMIT, 'source_id': q.SOURCE_ID, 'auditor_commit':q.AUDITOR_COMMIT,'release':q.RELEASE_VERSION,'embedded_offer':dict(q.EXPECTED_OFFER)}
                    (out / 'qualification.json').write_text(json.dumps(manifest))
                result = q.aggregate(root)
                self.assertEqual(len(result), 4)
                p = root / 'mac-intel' / q.expected_names('mac-intel')[0]
                p.write_bytes(b'changed')
                with self.assertRaises(ValueError):
                    q.aggregate(root)

    def test_mixed_version_or_auditor_receipts_block_aggregation(self):
        for key,bad in [('release','v7.0.0'),('auditor_commit','f'*40),('source_id','f'*64),('embedded_offer',{})]:
            with self.subTest(field=key),tempfile.TemporaryDirectory() as d:
                root=Path(d)
                for target in q.TARGETS:
                    out=root/target;out.mkdir();records={}
                    for n in q.expected_names(target):
                        p=out/n;p.write_bytes(n.encode());records[n]={'sha256':q.sha256(p),'release':q.RELEASE_VERSION,'source_commit':q.SOURCE_COMMIT,'source_id':q.SOURCE_ID,'auditor_commit':q.AUDITOR_COMMIT,'embedded_offer':dict(q.EXPECTED_OFFER),'runtime':{'status':'PASS'},'installation':{'bundle_version':q.VERSION},'cleanup':{'installed_bundle_absent':True}}
                    (out/'qualification.json').write_text(json.dumps(records))
                self.assertEqual(len(q.aggregate(root)),4)
                path=root/'mac-intel/qualification.json';records=json.loads(path.read_text());records[next(iter(records))][key]=bad;path.write_text(json.dumps(records))
                with self.assertRaises(ValueError):q.aggregate(root)


    def test_actual_copy_path_cleanup_and_changed_copy_refusal(self):
        for changed_copy in [False,True]:
            with self.subTest(changed_copy=changed_copy), tempfile.TemporaryDirectory() as directory:
                root=Path(directory);app=root/'app';app.mkdir();stage=app/'release-stage';stage.mkdir();(app/'src-tauri').mkdir()
                (app/'source-offer.json').write_text(json.dumps({'sourceId':q.SOURCE_ID}))
                (app/'src-tauri/tauri.conf.json').write_text(json.dumps({'version':q.VERSION}))
                records={}
                for name in q.expected_names('mac-intel'):
                    package=stage/name;package.write_bytes(name.encode());records[name]={'sha256':q.sha256(package)}
                (stage/'scan.json').write_text(json.dumps(records));temp=root/'runner-temp';temp.mkdir();launched=[]
                class Gate:
                    @staticmethod
                    def unpack(package,dest):
                        bundle=dest/'BDOBB.app';(bundle/'Contents/MacOS').mkdir(parents=True)
                        header=bytearray(64);header[:4]=b'\xcf\xfa\xed\xfe';struct.pack_into('<I',header,4,0x1000007)
                        (bundle/'Contents/MacOS/BDOBB').write_bytes(header)
                        (bundle/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleShortVersionString':q.VERSION,'CFBundleIdentifier':'com.artcashin.bdobb'}))
                    @staticmethod
                    def check_frontend(path):self.assertTrue((path/'main.js').is_file())
                def command(args,**kwargs):
                    if args[0]=='git':return subprocess.CompletedProcess(args,0,q.SOURCE_COMMIT+'\n','')
                    if args[0]=='ditto':
                        self.assertTrue(args[2].is_relative_to(temp));self.assertEqual(args[2].parts[-2:],('Applications','BDOBB.app'))
                        shutil.copytree(args[1],args[2])
                        if changed_copy:(args[2]/'Contents/MacOS/BDOBB').write_bytes(b'changed')
                    elif args[0]=='tauri-dumper':
                        frontend=args[args.index('-o')+1];frontend.mkdir();(frontend/'main.js').write_text(json.dumps(q.EXPECTED_OFFER))
                    else:self.assertEqual(args[0],'codesign')
                    return subprocess.CompletedProcess(args,0,'','')
                def runtime(executable,package,work,evidence,expected_arch):
                    self.assertTrue(executable.is_relative_to(temp));self.assertEqual(expected_arch,'x86_64');self.assertTrue(executable.exists());launched.append(executable)
                    return {'status':'PASS','displayed_about':{'status':'GAP_AX_NOT_TRUSTED'},'displayed_version_observed':False}
                with patch.dict(os.environ,{'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','RUNNER_TEMP':str(temp)}), patch.object(q.platform,'system',return_value='Darwin'), patch.object(q.platform,'machine',return_value='x86_64'), patch.object(q,'run',side_effect=command), patch.object(q,'load_release_gate',return_value=Gate), patch.object(q,'native_runtime',side_effect=runtime):
                    if changed_copy:
                        with self.assertRaisesRegex(ValueError,'Installed app copy differs'):q.qualify(app,'mac-intel')
                        self.assertEqual(launched,[]);self.assertFalse((stage/'qualification.json').exists())
                    else:
                        q.qualify(app,'mac-intel');qualified=json.loads((stage/'qualification.json').read_text());self.assertEqual(set(qualified),set(records))
                        self.assertEqual(len(launched),2)
                        for item in qualified.values():
                            self.assertTrue(item['cleanup']['installed_bundle_absent']);self.assertFalse(item['runtime']['displayed_version_observed'])
                self.assertEqual(list(temp.iterdir()),[])

def load_tests(loader,tests,pattern):
    suite=unittest.TestSuite([loader.loadTestsFromTestCase(ReleaseBindingTests)])
    for release in q.SUPPORTED_RELEASES:
        case=type('Qualification_'+release,(QualificationTest,),{'RELEASE':release})
        suite.addTests(loader.loadTestsFromTestCase(case))
    return suite

if __name__=="__main__":unittest.main()
