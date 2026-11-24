"""Exercise bounded owned cleanup at the Darwin process-group syscall boundary."""
import errno
import signal
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import owned_process as op


class OwnedProcessDrainTests(unittest.TestCase):
    def test_transient_eperm_after_term_waits_for_actual_group_absence(self):
        # Darwin can return EPERM while a terminated group has only zombies.
        # The regression is aborting this drain before its later ESRCH.
        state = {'term': False, 'permission_seen': False, 'absent_seen': False}
        def killpg(pgid, sig):
            self.assertEqual(pgid, 98765)
            if sig == signal.SIGTERM:
                state['term'] = True
            elif sig == 0:
                if state['term'] and not state['permission_seen']:
                    state['permission_seen'] = True
                    raise PermissionError(errno.EPERM, 'synthetic Darwin drain')
                if state['permission_seen']:
                    state['absent_seen'] = True
                    raise ProcessLookupError(errno.ESRCH, 'synthetic empty group')
            else:
                self.fail('No escalation is needed after the group disappears')
        def wait(timeout):
            self.assertTrue(state['absent_seen'], 'Must not accept EPERM as absence')
            return -signal.SIGTERM
        process = types.SimpleNamespace(pid=98765, poll=lambda: -signal.SIGTERM, wait=wait)
        with patch.object(op.os, 'killpg', side_effect=killpg):
            try:
                cleaned = op.cleanup_owned_group(process, term_timeout=1, kill_timeout=1)
            except PermissionError:
                self.fail('Transient EPERM aborted cleanup before the later ESRCH')
            self.assertTrue(cleaned)
        self.assertTrue(state['permission_seen'])
        self.assertTrue(state['absent_seen'])

    def test_persistent_eperm_is_present_and_never_proves_group_absent(self):
        # Returning False for permission failure would delete an unconfirmed tree.
        with patch.object(op.os, 'killpg', side_effect=PermissionError(errno.EPERM, 'synthetic denied group')):
            try:
                present = op.group_exists(98765)
            except PermissionError:
                self.fail('An unconfirmed group must remain present during bounded draining')
            self.assertTrue(present)

    def test_persistent_denial_refuses_and_preserves_private_workspace(self):
        process = types.SimpleNamespace(pid=98765, poll=lambda: -signal.SIGTERM, wait=lambda timeout: self.fail('Unconfirmed cleanup must not succeed'))
        term_sent = [False]
        def killpg(pgid, sig):
            self.assertEqual(pgid, 98765)
            if sig == signal.SIGTERM and not term_sent[0]:
                term_sent[0] = True
                return
            if term_sent[0]:
                raise PermissionError(errno.EPERM, 'synthetic persistent denied group')
        with tempfile.TemporaryDirectory() as raw:
            with self.assertRaises((PermissionError, ValueError)):
                with op.private_workspace(Path(raw)) as work:
                    try:
                        with patch.object(op.os, 'killpg', side_effect=killpg):
                            op.cleanup_owned_group(process, term_timeout=0, kill_timeout=0)
                    except BaseException:
                        (work / '.owned-tree-unconfirmed').write_text('GAP_OWNED_TREE_TEARDOWN_UNCONFIRMED\n')
                        raise
            self.assertTrue(work.is_dir())
            self.assertTrue((work / '.owned-tree-unconfirmed').is_file())

    def test_other_syscall_failure_is_not_absence(self):
        with patch.object(op.os, 'killpg', side_effect=OSError(errno.EIO, 'synthetic syscall failure')):
            with self.assertRaises(OSError):
                op.group_exists(98765)


if __name__ == '__main__':
    unittest.main()
