import contextlib, hashlib, importlib.util, io, json, os, tarfile, tempfile, unittest
from pathlib import Path
from unittest import mock
spec=importlib.util.spec_from_file_location('qa',Path(__file__).with_name('encrypt_qa_candidates.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
class RetentionTests(unittest.TestCase):
    def fixture(self,root):
        bundle=root/'bundle';names=[('dmg','BDOBB_4.0.0_x64.dmg'),('','BDOBB_x64.app.tar.gz')]
        for index,(directory,name) in enumerate(names):
            (bundle/directory).mkdir(parents=True,exist_ok=True);(bundle/directory/name).write_bytes(('synthetic package '+str(index)).encode())
        return bundle,names

    def test_exact_three_and_extra_or_ambiguous_packages_rejected(self):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                bundle, names = self.fixture(root)
                selected = qa.select_candidates(bundle, 'mac-intel')
                self.assertEqual({p.name for p in selected}, {name for _, name in names})
                extra = bundle / 'dmg/OTHER.dmg'
                extra.write_bytes(b'extra')
                with self.assertRaises(qa.RetentionError): qa.select_candidates(bundle, 'mac-intel')
                extra.unlink()
                duplicate = bundle / 'duplicate'
                duplicate.mkdir()
                (duplicate / names[0][1]).write_bytes(b'ambiguous')
                with self.assertRaises(qa.RetentionError): qa.select_candidates(bundle, 'mac-intel')

    def test_symlink_and_special_candidate_rejected_before_open(self):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                bundle, names = self.fixture(root)
                candidate = bundle / names[0][0] / names[0][1]
                candidate.unlink()
                candidate.symlink_to(bundle / names[1][0] / names[1][1])
                with self.assertRaises(qa.RetentionError): qa.select_candidates(bundle, 'mac-intel')
                candidate.unlink()
                if hasattr(os, 'mkfifo'):
                    os.mkfifo(candidate)
                    with self.assertRaises(qa.RetentionError): qa.select_candidates(bundle, 'mac-intel')

    def test_snapshot_tar_has_only_three_fixed_regular_names_and_changed_source_blocks(self):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                bundle, names = self.fixture(root)
                selected = qa.select_candidates(bundle, 'mac-intel')
                snapshot = root / 'snapshot'
                records = qa.snapshot_candidates(selected, snapshot)
                stream = io.BytesIO()
                qa.write_tar(stream, snapshot, records)
                stream.seek(0)
                with tarfile.open(fileobj=stream, mode='r:') as archive:
                    self.assertEqual(set(archive.getnames()), {name for _, name in names})
                    for member in archive.getmembers():
                        self.assertTrue(member.isfile())
                        self.assertEqual((member.uid, member.gid, member.mtime), (0, 0, 0))
                        self.assertEqual(archive.extractfile(member).read(), (snapshot / member.name).read_bytes())
                qa.verify_candidates(selected, records)
                selected[0].write_bytes(b'changed after snapshot')
                with self.assertRaises(qa.RetentionError): qa.verify_candidates(selected, records)

    def test_snapshot_extras_are_rejected_before_tar_streaming(self):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                bundle, _ = self.fixture(root)
                snapshot = root / 'snapshot'
                records = qa.snapshot_candidates(qa.select_candidates(bundle, 'mac-intel'), snapshot)
                (snapshot / 'unapproved.txt').write_bytes(b'must not enter archive')
                with self.assertRaises(qa.RetentionError): qa.write_tar(io.BytesIO(), snapshot, records)

    def test_output_directory_is_fresh_exact_runner_temp_child(self):
            with tempfile.TemporaryDirectory() as temporary:
                runner_temp = Path(temporary).resolve()
                expected = runner_temp / 'v4-encrypted-qa-mac-intel'
                qa.prepare_output(expected, runner_temp, 'mac-intel')
                self.assertEqual(list(expected.iterdir()), [])
                with self.assertRaises(qa.RetentionError): qa.prepare_output(expected, runner_temp, 'mac-intel')
                with self.assertRaises(qa.RetentionError): qa.prepare_output(runner_temp / 'other', runner_temp, 'mac-intel')

    def test_unreviewed_recipient_and_local_execution_rejected(self):
            with self.assertRaises(qa.RetentionError): qa.require_recipient('age1' + 'q' * 58)
            with mock.patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}, clear=False):
                with self.assertRaises(qa.RetentionError): qa.require_hosted_native('mac-intel')

    def test_single_recipient_pipe_protocol_without_executing_crypto(self):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                bundle, _ = self.fixture(root)
                records = qa.snapshot_candidates(qa.select_candidates(bundle, 'mac-intel'), root / 'snapshot')
                output = root / 'cipher.partial'
                output.write_bytes(b'age-encryption.org/v1\nsynthetic protocol fixture; not encryption')
                class Capture(io.BytesIO):
                    def close(self): pass
                sink = Capture()
                process = mock.Mock(stdin=sink)
                process.wait.return_value = 0
                process.poll.return_value = 0
                with mock.patch.object(qa.subprocess, 'Popen', return_value=process) as start:
                    qa.encrypt_stream(root / 'age', qa.RECIPIENT, root / 'snapshot', records, output)
                self.assertEqual(start.call_args.args[0], [str(root / 'age'), '-r', qa.RECIPIENT, '-o', str(output)])
                self.assertEqual(start.call_args.kwargs['stdout'], qa.subprocess.DEVNULL)
                self.assertEqual(start.call_args.kwargs['stderr'], qa.subprocess.DEVNULL)
                sink.seek(0)
                with tarfile.open(fileobj=sink, mode='r:') as archive:
                    self.assertEqual(set(archive.getnames()), {row['filename'] for row in records})

    def test_cli_never_prints_exception_details_or_invalid_recipient(self):
            secret = 'never-print-this-credential'
            common = ['--target', 'mac-intel', '--app', '/app', '--auditor', '/auditor', '--controller', '/controller', '--outdir', '/out', '--failure-stage', 'package-scan', '--qualification-outcome', 'failure']
            for argv in [['--unexpected', secret], common + ['--recipient', secret], common + ['--recipient', qa.RECIPIENT]]:
                output, error = io.StringIO(), io.StringIO()
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(error), mock.patch.object(qa, 'retain', side_effect=RuntimeError(secret)):
                    status = qa.main(argv)
                self.assertNotEqual(status, 0)
                self.assertNotIn(secret, output.getvalue() + error.getvalue())
                self.assertEqual(output.getvalue(), '')
                self.assertEqual(json.loads(error.getvalue())['status'], 'QA_RETENTION_FAILED')

    def test_targets_and_official_age_pins_are_exact(self):
        self.assertEqual(set(qa.TARGETS),{'mac-arm','mac-intel','table-amd64'})
        self.assertEqual(len(qa.TARGETS['mac-arm']['files']),2);self.assertEqual(len(qa.TARGETS['table-amd64']['files']),1)
        self.assertEqual(qa.AGE['darwin-arm64']['binary_size'],6502258)
        self.assertEqual(qa.AGE['darwin-amd64']['binary_size'],6978992)
        self.assertEqual(qa.AGE['linux-amd64']['binary_size'],6977014)
        self.assertEqual(hashlib.sha256(qa.RECIPIENT.encode()).hexdigest(),qa.RECIPIENT_FINGERPRINT)
    def test_table_selection_and_identity_bind_actual_image_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();candidate=root/'candidate-table-image-amd64.tar.gz';candidate.write_bytes(b'synthetic image')
            selected=qa.select_candidates(root,'table-amd64');self.assertEqual(selected,[candidate])
            records=qa.snapshot_candidates(selected,root/'snapshot')
            identity={'source_revision':qa.TARGETS['table-amd64']['source'],'source_tree':'e8b331b5f813defc34cbbbb7aa6b5b5e0f3a3cb2','architecture':'amd64','candidate_sha256':records[0]['sha256'],'image_id':'sha256:'+'a'*64,'service_tests':79,'core_tests':213,'runtime_passed':True}
            manifest=root/'candidate-table-image-amd64.identity.json';manifest.write_text(json.dumps(identity));self.assertEqual(qa.image_identity(root,records[0]),identity)
            for key,value in [('candidate_sha256','f'*64),('service_tests',78),('image_id','unapproved raw text'),('runtime_passed',False)]:
                bad={**identity,key:value};manifest.write_text(json.dumps(bad))
                with self.assertRaises(qa.RetentionError):qa.image_identity(root,records[0])
            extra=root/'candidate-table-image-foreign.tar.gz';extra.write_bytes(b'extra')
            with self.assertRaises(qa.RetentionError):qa.select_candidates(root,'table-amd64')
    def test_receipt_remains_blocked_and_contains_no_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();cipher=root/'qa-blocked-v4-mac-intel.tar.age';cipher.write_bytes(b'age-encryption.org/v1\nsynthetic ciphertext')
            r=qa.make_receipt('mac-intel',[{'filename':'BDOBB_4.0.0_x64.dmg','size':1,'sha256':'a'*64}],cipher,'b'*40,'package-scan')
            self.assertEqual(r['qualification_state'],'FAILED/BLOCKED');self.assertEqual(r['retention_days'],1);self.assertIsNone(r['image_identity']);self.assertNotIn('synthetic ciphertext',json.dumps(r));self.assertNotIn('AGE-SECRET-KEY',json.dumps(r))
if __name__=='__main__':unittest.main()
