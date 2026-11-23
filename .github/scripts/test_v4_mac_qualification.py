import importlib.util, json, os, plistlib, shutil, struct, subprocess, tempfile, unittest
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('qualification',Path(__file__).with_name('v4_mac_qualification.py'))
q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)
class QualificationTest(unittest.TestCase):
    def test_only_four_original_v4_mac_names_and_final_offer(self):
        self.assertEqual(set(q.TARGETS),{'mac-arm','mac-intel'})
        self.assertEqual({name for target in q.TARGETS for name in q.expected_names(target)}, {'BDOBB_4.0.0_aarch64.dmg','BDOBB_4.0.0_x64.dmg','BDOBB_aarch64.app.tar.gz','BDOBB_x64.app.tar.gz'})
        self.assertEqual(q.SOURCE_COMMIT,'fecff636e2389d417a320b66c9264d612ebb3a64')
        self.assertEqual(q.SOURCE_ID,'00b661cf92ed7bebfa52a104b99ed5e9cb52e0873a2370fad1b22a07fe58633c')
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
                        manifest[n] = {'sha256': q.sha256(p), 'runtime': {'status': 'PASS'}, 'installation':{'bundle_version':'4.0.0'}, 'cleanup':{'installed_bundle_absent':True}, 'source_commit': q.SOURCE_COMMIT, 'source_id': q.SOURCE_ID}
                    (out / 'qualification.json').write_text(json.dumps(manifest))
                result = q.aggregate(root)
                self.assertEqual(len(result), 4)
                p = root / 'mac-intel' / q.expected_names('mac-intel')[0]
                p.write_bytes(b'changed')
                with self.assertRaises(ValueError):
                    q.aggregate(root)


    def test_actual_copy_path_cleanup_and_changed_copy_refusal(self):
        for changed_copy in [False,True]:
            with self.subTest(changed_copy=changed_copy), tempfile.TemporaryDirectory() as directory:
                root=Path(directory);app=root/'app';app.mkdir();stage=app/'release-stage';stage.mkdir();(app/'src-tauri').mkdir()
                (app/'source-offer.json').write_text(json.dumps({'sourceId':q.SOURCE_ID}))
                (app/'src-tauri/tauri.conf.json').write_text(json.dumps({'version':'4.0.0'}))
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
                        (bundle/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleShortVersionString':'4.0.0','CFBundleIdentifier':'com.artcashin.bdobb'}))
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

if __name__=="__main__":unittest.main()
