"""Synthetic controls: no app launch, provider, native UI or network observation."""
import importlib.util,json,os,signal,subprocess,sys,tempfile,types,unittest,shutil
from pathlib import Path
from unittest.mock import patch
import v4_mac_qualification as q
HERE=Path(__file__).parent

class PriorMacControls(unittest.TestCase):
 def test_only_three_prior_versions_can_bind_and_disabled_slots_refuse(self):
  self.assertEqual(q.SUPPORTED_RELEASES,('v4.0.0','v5.0.0','v6.0.0'))
  from test_v4_mac_qualification import binding_manifest
  for release in q.SUPPORTED_RELEASES:
   with tempfile.TemporaryDirectory() as raw:
    value=binding_manifest();value['bindings'][release].update(state='DISABLED_PENDING_ROOT_FREEZE',productCommit=None,auditorCommit=None,baseCommit=None,sourceId=None)
    path=Path(raw)/'binding.json';path.write_text(json.dumps(value))
    with self.assertRaisesRegex(ValueError,'Unfrozen'):q.load_release_binding(release,path)
 def test_structured_names_need_unique_pass_and_exact_pending_accounting(self):
  self.assertTrue(callable(getattr(q,'verify_source_results',None)))
  results={'numPassedTests':2,'numFailedTests':0,'numPendingTests':1,'testResults':[{'assertionResults':[{'fullName':'reader refresh','status':'passed'},{'fullName':'reader scroll','status':'passed'},{'fullName':'known pending','status':'skipped'}]}]}
  counts={'frontend':2,'source_offer':26,'pending':1,'required_names':['reader refresh','reader scroll'],'skipped_names':['known pending']}
  receipt=q.verify_source_results(results,counts)
  self.assertEqual(receipt,{'frontend':2,'source_offer':26,'pending':1,'required_names':['reader refresh','reader scroll'],'skipped_names':['known pending'],'nonpassed_tests':[{'full_name':'known pending','status':'skipped'}]})
  for mutation in ['skip','duplicate','compensate','pending-count','failed','extra-unknown']:
   changed=json.loads(json.dumps(results));rows=changed['testResults'][0]['assertionResults']
   if mutation=='skip':rows[0]['status']='pending'
   elif mutation=='duplicate':rows[1]['fullName']='reader refresh'
   elif mutation=='compensate':rows[0]['status']='pending';rows.append({'fullName':'extra','status':'passed'})
   elif mutation=='pending-count':changed['numPendingTests']=2
   elif mutation=='failed':rows[2]['status']='failed'
   else:rows.append({'fullName':'unknown','status':'disabled'})
   with self.subTest(mutation=mutation),self.assertRaises(ValueError):q.verify_source_results(changed,counts)
 def test_source_offer_requires_26_passes_and_zero_skip_todo_cancel(self):
  self.assertTrue(callable(getattr(q,'verify_source_offer_log',None)))
  log='# tests 26\n# suites 0\n# pass 26\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
  q.verify_source_offer_log(log,26)
  for changed in [log.replace('# pass 26','# pass 25'),log.replace('# skipped 0','# skipped 1'),log+log,log.replace('# cancelled 0','# cancelled 1')]:
   with self.assertRaises(ValueError):q.verify_source_offer_log(changed,26)
 def test_scanner_interpreter_needs_owned_python312_pillow13(self):
  self.assertTrue(callable(getattr(q,'scanner_python',None)))
  with tempfile.TemporaryDirectory() as raw:
   root=Path(raw).resolve();venv=root/'mac-scanner';exe=venv/'bin/python';exe.parent.mkdir(parents=True);exe.write_bytes(b'NEVER EXECUTED');(venv/'pyvenv.cfg').write_text('synthetic')
   for prefix,pillow,version,want in [(venv,'13.0.0',[3,12],True),(root,'13.0.0',[3,12],False),(venv,'12.0.0',[3,12],False),(venv,'13.0.0',[3,11],False)]:
    result=types.SimpleNamespace(returncode=0,stdout=json.dumps([str(prefix),pillow,version]))
    with patch.dict(os.environ,{'RUNNER_TEMP':str(root),'SCANNER_PY':str(exe)}),patch.object(q.subprocess,'run',return_value=result):
     if want:self.assertEqual(q.scanner_python(),exe)
     else:
      with self.assertRaises(ValueError):q.scanner_python()
 def test_parent_exit_still_requires_descendant_sigkill_and_empty_group(self):
  self.assertTrue((HERE/'owned_process.py').is_file())
  import owned_process as op
  alive=[True];signals=[];clock=[0]
  def kill(pid,sig):
   self.assertEqual(pid,98765)
   if sig==0:
    if not alive[0]:raise ProcessLookupError
   else:
    signals.append(sig)
    if sig==signal.SIGKILL:alive[0]=False
  def tick():clock[0]+=.5;return clock[0]
  proc=types.SimpleNamespace(pid=98765,poll=lambda:0,wait=lambda timeout:0)
  with patch.object(op.os,'killpg',side_effect=kill),patch.object(op.time,'monotonic',side_effect=tick),patch.object(op.time,'sleep'):
   self.assertTrue(op.cleanup_owned_group(proc,term_timeout=1,kill_timeout=1))
  self.assertIn(signal.SIGKILL,signals);self.assertFalse(alive[0])
 def test_surviving_group_preserves_private_workspace_and_refuses(self):
  self.assertTrue((HERE/'owned_process.py').is_file())
  import owned_process as op
  with tempfile.TemporaryDirectory() as raw:
   with self.assertRaises(ValueError):
    with op.private_workspace(Path(raw)) as work:(work/'.owned-tree-unconfirmed').write_text('GAP')
   self.assertTrue(work.is_dir());shutil.rmtree(work)
  clock=[0]
  def tick():clock[0]+=.5;return clock[0]
  proc=types.SimpleNamespace(pid=98765,poll=lambda:0,wait=lambda timeout:0)
  with patch.object(op.os,'killpg'),patch.object(op.time,'monotonic',side_effect=tick),patch.object(op.time,'sleep'):
   with self.assertRaises(ValueError):op.cleanup_owned_group(proc,term_timeout=1,kill_timeout=1)
 def test_swift_actual_pure_decision_is_version_bounded_and_rejects_stale_dialog(self):
  source=(HERE/'mac_about_probe.swift').read_text()
  self.assertIn('// BEGIN PURE ABOUT ACCEPTANCE',source)
  core=source.split('// BEGIN PURE ABOUT ACCEPTANCE\n',1)[1].split('// END PURE ABOUT ACCEPTANCE',1)[0]
  fixture='''
for expected in ["4.0.0","5.0.0","6.0.0"] {
 let versions: Set<String> = ["Version \\(expected) (\\(expected))"]
 func observed(_ title: String?, _ invoked: Bool = true, _ focused: Bool = true, _ shown: Set<String>? = nil, _ subrole: String = "AXDialog", _ fresh: Bool = true, _ owned: Bool = true, _ front: Bool = true, _ hidden: Bool = false, _ minimized: Bool = false, _ want: String? = nil) -> Bool {
  return aboutObservationAccepted(title: title, role: "AXWindow", subrole: subrole, newWindow: fresh, owned: owned, focused: focused, frontmost: front, hidden: hidden, minimized: minimized, invoked: invoked, names: ["BDOBB"], versions: shown ?? versions, expectedVersion: want ?? expected)
 }
 precondition(observed("About BDOBB"));precondition(observed(""));precondition(observed("About"))
 precondition(!observed(nil));precondition(!observed("BDOBB"));precondition(!observed("Preferences"));precondition(!observed("",true,true,nil,"AXStandardWindow"));precondition(!observed("",true,true,nil,"AXDialog",false))
 precondition(!observed("About BDOBB",false));precondition(!observed("About BDOBB",true,false))
 precondition(!observed("About BDOBB",true,true,["Version 7.0.0 (7.0.0)"]))
 precondition(!observed("About BDOBB",true,true,["Version \\(expected) (\\(expected))partial"]))
 precondition(!observed("About BDOBB",true,true,nil,"AXDialog",true,false));precondition(!observed("About BDOBB",true,true,nil,"AXDialog",true,true,false));precondition(!observed("About BDOBB",true,true,nil,"AXDialog",true,true,true,true));precondition(!observed("About BDOBB",true,true,nil,"AXDialog",true,true,true,false,true))
 precondition(!observed("About BDOBB",true,true,["Version 7.0.0 (7.0.0)"],"AXDialog",true,true,true,false,false,"7.0.0"))
}
precondition(!aboutTextIsVisible(inWindow:true,ownedHit:false));precondition(!aboutTextIsVisible(inWindow:false,ownedHit:true));precondition(aboutTextIsVisible(inWindow:true,ownedHit:true))
'''
  with tempfile.TemporaryDirectory() as raw:
   root=Path(raw);src=root/'pure.swift';src.write_text('import Foundation\n'+core+fixture);exe=root/'pure'
   build=subprocess.run(['/usr/bin/swiftc',str(src),'-module-cache-path',str(root/'module-cache'),'-o',str(exe)],capture_output=True,timeout=90)
   self.assertEqual(build.returncode,0,build.stderr.decode()[:2000]);ran=subprocess.run([str(exe)],capture_output=True,timeout=10);self.assertEqual(ran.returncode,0,ran.stderr.decode()[:1000])

class HistoryPolicyControls(unittest.TestCase):
 def workflow_history_selection(self):
  import textwrap
  workflow=(HERE.parent/'workflows/v4-table-amd64-qualification.yml').read_text()
  self.assertIn('# BEGIN EXACT VERSION HISTORY POLICY',workflow)
  return textwrap.dedent(workflow.split('# BEGIN EXACT VERSION HISTORY POLICY\n',1)[1].split('# END EXACT VERSION HISTORY POLICY',1)[0])
 def run_selection(self,root,release):
  env=dict(os.environ,BDOBB_RELEASE_VERSION=release)
  return subprocess.run(['bash','-euc',self.workflow_history_selection()+'\nprintf "%s" "$history_exceptions"'],cwd=root,env=env,capture_output=True,text=True)
 def fixture(self,root,names):
  subprocess.run(['git','init','-q',str(root)],check=True)
  (root/'placeholder').write_text('synthetic history policy control\n')
  for name in names:
   path=root/name;path.parent.mkdir(exist_ok=True);path.write_text('[]\n')
  subprocess.run(['git','add','.'],cwd=root,check=True)
  subprocess.run(['git','-c','user.name=Synthetic QA','-c','user.email=qa@example.invalid','commit','-qm','synthetic policy fixture'],cwd=root,check=True)
 def test_actual_workflow_selects_exact_version_committed_policy(self):
  for release,expected in [('v4.0.0','security/privacy-exceptions.json'),('v5.0.0','security/privacy-exceptions.json'),('v6.0.0','security/privacy-history-exceptions.json')]:
   with self.subTest(release=release),tempfile.TemporaryDirectory() as raw:
    root=Path(raw);self.fixture(root,['security/privacy-exceptions.json','security/privacy-history-exceptions.json'])
    result=self.run_selection(root,release);self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout,expected)
 def test_missing_required_policy_refuses_without_using_other_file(self):
  for release,other in [('v4.0.0','security/privacy-history-exceptions.json'),('v5.0.0','security/privacy-history-exceptions.json'),('v6.0.0','security/privacy-exceptions.json')]:
   with self.subTest(release=release),tempfile.TemporaryDirectory() as raw:
    root=Path(raw);self.fixture(root,[other]);self.assertNotEqual(self.run_selection(root,release).returncode,0)
 def test_uncommitted_or_symlink_policy_and_unknown_release_refuse(self):
  with tempfile.TemporaryDirectory() as raw:
   root=Path(raw);self.fixture(root,[]);policy=root/'security/privacy-exceptions.json';policy.parent.mkdir();policy.write_text('[]\n');self.assertNotEqual(self.run_selection(root,'v4.0.0').returncode,0)
  with tempfile.TemporaryDirectory() as raw:
   root=Path(raw);self.fixture(root,['security/privacy-exceptions.json']);policy=root/'security/privacy-exceptions.json';policy.unlink();policy.symlink_to(root/'placeholder');self.assertNotEqual(self.run_selection(root,'v4.0.0').returncode,0)
  with tempfile.TemporaryDirectory() as raw:
   root=Path(raw);self.fixture(root,['security/privacy-exceptions.json','security/privacy-history-exceptions.json'])
   for release in ['v3.0.0','v7.0.0','main','']:
    self.assertNotEqual(self.run_selection(root,release).returncode,0)

class SourceDriverControls(unittest.TestCase):
 def setUp(self):
  from test_v4_mac_qualification import binding_fixture
  q.configure_release(binding_fixture("v6.0.0"))
 def test_actual_driver_accepts_ten_mib_results_and_keeps_intel_only_single_worker(self):
  counts={'frontend':2,'source_offer':26,'pending':0,'required_names':['reader refresh','reader scroll'],'skipped_names':[]}
  for target in ['mac-arm','mac-intel']:
   with self.subTest(target=target),tempfile.TemporaryDirectory() as raw:
    app=Path(raw);evidence=app/'qualification-evidence';evidence.mkdir();commands=[]
    def execute(args,**kwargs):
     self.assertEqual(kwargs['timeout'],1800);self.assertEqual(kwargs['cwd'],app);commands.append(args)
     if args[0]=='node':kwargs['stdout'].write('# tests 26\n# pass 26\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')
     else:
      kwargs['stdout'].write('Tests 2 passed (2)\n')
      result={'numPassedTests':2,'numFailedTests':0,'numPendingTests':0,'testResults':[{'assertionResults':[{'fullName':'reader refresh','status':'passed'},{'fullName':'reader scroll','status':'passed'}]}],'synthetic_padding':'x'*(10*1024*1024)}
      (evidence/'frontend-results.json').write_text(json.dumps(result))
     return types.SimpleNamespace(returncode=0)
    with patch.object(q.subprocess,'run',side_effect=execute):q.test_product(app,{'counts':counts},target)
    self.assertEqual(json.loads((evidence/'test-counts.json').read_text()),q.source_test_receipt(counts));self.assertEqual(len(commands),2)
    self.assertEqual('--maxWorkers=1' in commands[1],target=='mac-intel');self.assertFalse(any(arg.startswith('--exclude') for arg in commands[1]))
 def test_actual_driver_refuses_oversized_results_without_exporting_raw_log(self):
  counts={'frontend':2,'source_offer':26,'pending':0,'required_names':['reader refresh','reader scroll'],'skipped_names':[]}
  with tempfile.TemporaryDirectory() as raw:
   app=Path(raw);evidence=app/'qualification-evidence';evidence.mkdir()
   def execute(args,**kwargs):
    if args[0]=='node':kwargs['stdout'].write('# tests 26\n# pass 26\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')
    else:
     kwargs['stdout'].write('PRIVATE_TEST_FAILURE_DETAIL\n')
     with (evidence/'frontend-results.json').open('wb') as out:out.truncate(16*1024*1024+1)
    return types.SimpleNamespace(returncode=0)
   with patch.object(q.subprocess,'run',side_effect=execute),self.assertRaises(ValueError):q.test_product(app,{'counts':counts},'mac-intel')
   diagnostic=(evidence/'test-refusal.json').read_text();self.assertLessEqual(len(diagnostic.encode()),8192);self.assertNotIn('PRIVATE_TEST_FAILURE_DETAIL',diagnostic)
   self.assertEqual(json.loads(diagnostic)['reason'],'RESULTS_LIMIT');self.assertFalse((evidence/'test-counts.json').exists())

class AboutBaselineReadTests(unittest.TestCase):
 def test_required_actual_children_refuses_failed_or_missing_baseline_but_accepts_successful_empty(self):
  import shutil
  if sys.platform!='darwin':self.skipTest('Actual AX/CoreFoundation boundary fixture requires macOS')
  swift=shutil.which('swiftc')
  if swift is None:self.skipTest('Swift compiler unavailable')
  source=Path(__file__).with_name('mac_about_probe.swift').read_text()
  core='private func children'+source.split('private func children',1)[1].split('private func walk',1)[0]
  fixture='''import Foundation
import CoreFoundation
typealias AXUIElement = CFString
let kAXChildrenAttribute = "AXChildren"
private enum ProbeFailure: Error { case unavailable, budget }
private enum ResultCode { case success, failure }
private var resultCode = ResultCode.failure
private var copiedValues: CFArray? = nil
private func prepare(_ element: AXUIElement) throws {}
private func AXUIElementGetTypeID() -> CFTypeID { return CFStringGetTypeID() }
private func AXUIElementCopyAttributeValues(_ element: AXUIElement, _ name: CFString, _ offset: Int, _ limit: Int, _ values: UnsafeMutablePointer<CFArray?>) -> ResultCode { values.pointee=copiedValues;return resultCode }
''' + core + '''
let app = "fixture" as CFString
func strictReadRefuses() -> Bool {
 do { _ = try children(app, required: true);return false } catch { return true }
}
precondition(strictReadRefuses()) // actual AX failure is not an empty baseline
resultCode = .success
precondition(strictReadRefuses()) // missing result is not an empty baseline
copiedValues = CFArrayCreate(nil,nil,0,nil)
precondition((try! children(app, required: true)).isEmpty) // genuine successful empty is valid
resultCode = .failure
precondition((try! children(app)).isEmpty) // unrelated optional traversal retains prior behavior
'''
  with tempfile.TemporaryDirectory() as raw:
   root=Path(raw);path=root/'baseline.swift';path.write_text(fixture);binary=root/'baseline';built=subprocess.run([swift,str(path),'-module-cache-path',str(root/'module-cache'),'-o',str(binary)],capture_output=True,timeout=90);self.assertEqual(built.returncode,0,built.stderr.decode()[:1000]);ran=subprocess.run([str(binary)],capture_output=True,timeout=10);self.assertEqual(ran.returncode,0,ran.stderr.decode()[:1000])

if __name__=='__main__':unittest.main()
