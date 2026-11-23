import contextlib,hashlib,importlib.util,io,json,os,tarfile,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
spec=importlib.util.spec_from_file_location('qa',Path(__file__).with_name('encrypt_v5_table_candidates.py'))
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
TARGET='table-v5-final-amd64'
class RetentionTests(unittest.TestCase):
 def fixture(self,root,target=TARGET):
  candidate=root/qa.TARGETS[target]['files'][''];candidate.write_bytes(b'synthetic saved image, never an actual candidate');return candidate
 def identity(self,record,target=TARGET):
  c=qa.TARGETS[target];return {'source_revision':c['code_revision'],'source_tree':c['tree'],'architecture':c['architecture'],'candidate_sha256':record['sha256'],'image_id':'sha256:'+'a'*64,'service_tests':80,'core_tests':219,'runtime_passed':True}
 def test_only_new_v5_scopes_and_exact_product_code_roles(self):
  self.assertEqual(set(qa.TARGETS),{'table-v5-final-amd64','table-v5-final-arm64'})
  for c in qa.TARGETS.values():
   self.assertEqual(c['source'],'75dbcec84ef82f675385dce80879e4d926e89c0a');self.assertEqual(c['auditor'],c['source'])
   self.assertEqual(c['code_revision'],'1244589e3d4c32b4736f97c6a011505414baf593');self.assertEqual(c['tree'],'2d7cd23ab5329156841af84ff4fc8ab69178eb79')
   self.assertEqual(c['offer'],'31fd0bc90325c12cfe43f492139976ca4659ae6f759e87b3d2a59e634fa8b16c')
 def test_exact_one_image_no_extras_or_ambiguous_name(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t).resolve();p=self.fixture(root);self.assertEqual(qa.select_candidates(root,TARGET),[p])
   (root/'candidate-table-image-foreign.tar.gz').write_bytes(b'extra')
   with self.assertRaises(qa.RetentionError):qa.select_candidates(root,TARGET)
 def test_symlink_and_special_candidate_refused(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t).resolve();p=self.fixture(root);p.unlink();p.symlink_to(root/'missing')
   with self.assertRaises(qa.RetentionError):qa.select_candidates(root,TARGET)
   p.unlink();os.mkfifo(p)
   with self.assertRaises(qa.RetentionError):qa.select_candidates(root,TARGET)
 def test_snapshot_tar_has_one_fixed_regular_name_and_no_content_changes(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t).resolve();p=self.fixture(root);records=qa.snapshot_candidates([p],root/'snapshot');stream=io.BytesIO();qa.write_tar(stream,root/'snapshot',records);stream.seek(0)
   with tarfile.open(fileobj=stream) as a:
    self.assertEqual(a.getnames(),[p.name]);m=a.getmembers()[0];self.assertTrue(m.isfile());self.assertEqual((m.uid,m.gid,m.mtime),(0,0,0));self.assertEqual(a.extractfile(m).read(),p.read_bytes())
   p.write_bytes(b'changed')
   with self.assertRaises(qa.RetentionError):qa.verify_candidates([p],records)
 def test_snapshot_extras_refused_before_streaming(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t).resolve();p=self.fixture(root);records=qa.snapshot_candidates([p],root/'snapshot');(root/'snapshot/extra').write_bytes(b'extra')
   with self.assertRaises(qa.RetentionError):qa.write_tar(io.BytesIO(),root/'snapshot',records)
 def test_exact_fresh_output_under_physical_runner_temp(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t).resolve();p=root/('v5-encrypted-qa-'+TARGET);qa.prepare_output(p,root,TARGET)
   for other in [p,root/'foreign']:
    with self.assertRaises(qa.RetentionError):qa.prepare_output(other,root,TARGET)
 def test_hosted_native_and_public_recipient_only(self):
  qa.require_recipient(qa.RECIPIENT)
  for bad in ['age1'+'q'*58,'age160m7enkqn7g3gy9sm66keanjfsnkjfs2u6ce57w3jzz8egvm7erq39zaqx']:
   with self.assertRaises(qa.RetentionError):qa.require_recipient(bad)
  with mock.patch.dict(os.environ,{'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','RUNNER_OS':'Linux'},clear=True),mock.patch.object(qa.platform,'system',return_value='Linux'),mock.patch.object(qa.platform,'machine',return_value='x86_64'):
   qa.require_hosted_native(TARGET)
   with self.assertRaises(qa.RetentionError):qa.require_hosted_native('table-v5-final-arm64')
 def test_single_recipient_stream_without_executing_crypto(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t).resolve();p=self.fixture(root);records=qa.snapshot_candidates([p],root/'snapshot');output=root/'cipher';output.write_bytes(b'age-encryption.org/v1\nsynthetic protocol fixture')
   class Capture(io.BytesIO):
    def close(self):pass
   sink=Capture();process=mock.Mock(stdin=sink);process.wait.return_value=0;process.poll.return_value=0
   with mock.patch.object(qa.subprocess,'Popen',return_value=process) as start:qa.encrypt_stream(root/'age',qa.RECIPIENT,root/'snapshot',records,output)
   self.assertEqual(start.call_args.args[0],[str(root/'age'),'-r',qa.RECIPIENT,'-o',str(output)]);self.assertEqual(start.call_args.kwargs['stderr'],qa.subprocess.DEVNULL)
   sink.seek(0)
   with tarfile.open(fileobj=sink) as archive:self.assertEqual(archive.getnames(),[p.name])
 def test_identity_binds_exact_code_not_metadata_product_and_native_arch_counts(self):
  for target in qa.TARGETS:
   with self.subTest(target=target),tempfile.TemporaryDirectory() as t:
    root=Path(t).resolve();p=self.fixture(root,target);records=qa.snapshot_candidates([p],root/'snapshot');good=self.identity(records[0],target);path=root/('candidate-table-image-'+qa.TARGETS[target]['architecture']+'.identity.json');path.write_text(json.dumps(good));self.assertEqual(qa.image_identity(root,records[0],target),good)
    for key,bad in [('source_revision',qa.TARGETS[target]['source']),('source_tree','0'*40),('architecture','foreign'),('candidate_sha256','0'*64),('service_tests',79),('core_tests',217),('runtime_passed',False)]:
     path.write_text(json.dumps({**good,key:bad}))
     with self.subTest(key=key),self.assertRaises(qa.RetentionError):qa.image_identity(root,records[0],target)
 def test_only_failed_image_privacy_stage_permitted(self):
  for outcome,stage in [('success','image-privacy'),('failure','native-qualification'),('failure','package-scan')]:
   args=SimpleNamespace(target=TARGET,recipient=qa.RECIPIENT,qualification_outcome=outcome,failure_stage=stage)
   with mock.patch.object(qa,'require_hosted_native'),self.assertRaisesRegex(qa.RetentionError,'ORIGINAL_FAILURE_REQUIRED'):qa.retain(args)
 def test_cli_error_is_static_never_leaks_raw_exception_or_input(self):
  secret='never-print-private-content';args=['--target',TARGET,'--app','/app','--auditor','/app','--controller','/controller','--outdir','/out','--failure-stage','image-privacy','--qualification-outcome','failure','--recipient',qa.RECIPIENT]
  output,error=io.StringIO(),io.StringIO()
  with contextlib.redirect_stdout(output),contextlib.redirect_stderr(error),mock.patch.object(qa,'retain',side_effect=RuntimeError(secret)):self.assertEqual(qa.main(args),1)
  self.assertEqual(output.getvalue(),'');self.assertNotIn(secret,error.getvalue());self.assertEqual(json.loads(error.getvalue()),{'status':'QA_RETENTION_FAILED','code':'RETENTION_OPERATION_FAILED'})
 def test_receipt_remains_blocked_with_distinct_image_code_product_and_no_payload(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t).resolve();cipher=root/'cipher';cipher.write_bytes(b'age-encryption.org/v1\nsynthetic cipher');r=qa.make_receipt(TARGET,[{'filename':'candidate-table-image-amd64.tar.gz','size':1,'sha256':'a'*64}],cipher,'b'*40,'image-privacy')
   self.assertEqual(r['qualification_state'],'FAILED/BLOCKED');self.assertEqual(r['retention_days'],1);self.assertEqual(r['source_commit'],qa.TARGETS[TARGET]['source']);self.assertEqual(r['image_code_commit'],qa.TARGETS[TARGET]['code_revision']);self.assertNotIn('synthetic cipher',json.dumps(r))
 def test_official_age_pins_retained_and_fingerprint_matches_public_recipient(self):
  self.assertEqual(qa.AGE['linux-amd64']['archive_sha256'],'cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10');self.assertEqual(qa.AGE['linux-arm64']['archive_sha256'],'6b8dc4333c53a5a57c9e5834e3a48f92605d7154014cd07269ff3327db5d37f4');self.assertEqual(hashlib.sha256(qa.RECIPIENT.encode()).hexdigest(),qa.RECIPIENT_FINGERPRINT)
 def test_physical_parent_alias_refused(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t).resolve();real=root/'real';real.mkdir();p=self.fixture(real);alias=root/'alias';alias.symlink_to(real,target_is_directory=True)
   with self.assertRaises(qa.RetentionError):qa.physical_directory(alias)
if __name__=='__main__':unittest.main()
