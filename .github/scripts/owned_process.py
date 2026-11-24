"""Owned runner process trees. No parent-only cleanup success or ambient process kill."""
import contextlib,os,shutil,signal,tempfile,time
from pathlib import Path
def require(value):
 if not value:raise ValueError("Owned process teardown refused")

@contextlib.contextmanager
def private_workspace(parent,prefix='mac-private-install-'):
 work=Path(tempfile.mkdtemp(prefix=prefix,dir=parent))
 try:yield work
 finally:
  # A failed teardown must not delete a still-mapped private profile. The
  # disposable runner owns final destruction; this is never uploaded as success.
  require(not (work/'.owned-tree-unconfirmed').exists());shutil.rmtree(work)

def group_exists(pgid):
 try:os.killpg(pgid,0);return True
 except ProcessLookupError:return False
 # Darwin can return EPERM while a terminated group has only zombies.
 # Permission failure is present/unconfirmed; only ESRCH proves absence.
 except PermissionError:return True

def cleanup_owned_group(process,term_timeout=3,kill_timeout=5):
 require(type(process.pid) is int and process.pid>1)
 def drained(timeout):
  deadline=time.monotonic()+timeout
  while True:
   process.poll() # reap our root even if it exited before a descendant
   if not group_exists(process.pid):return True
   if time.monotonic()>=deadline:return False
   time.sleep(.05)
 try:
  if group_exists(process.pid):os.killpg(process.pid,signal.SIGTERM)
 except ProcessLookupError:pass
 if not drained(term_timeout):
  try:os.killpg(process.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  require(drained(kill_timeout))
 process.wait(timeout=2);require(not group_exists(process.pid));return True

