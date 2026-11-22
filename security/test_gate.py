"""Behavioral security tests. All credentials are generated synthetic fixtures."""
import base64
import hashlib
import io
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock
import zipfile

HERE = Path(__file__).resolve().parent

class GateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'test@example.com')
        self.git('config', 'user.name', 'Gate Test')
        (self.repo / 'README.md').write_text('public example\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'initial')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.DEVNULL)

    def run_gate(self, *args, env=None, input=None):
        return subprocess.run([sys.executable, str(HERE / 'gate.py'), '--repo', str(self.repo), *map(str,args)],
            env={**os.environ, **(env or {})}, capture_output=True, text=True, input=input)

    def assert_blocked(self, result, rule=None):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        if rule:
            self.assertIn(rule, result.stdout + result.stderr)

    def test_tailscale_variants_and_inline_bypasses(self):
        for kind in ['auth', 'api', 'client', 'unknown']:
            with self.subTest(kind=kind):
                token = 'tskey-' + kind + '-' + 'A9b8C7d6E5f4G3h2I1j0' * 2
                p = self.repo / 'credential.txt'
                p.write_text(token + ' # gitleaks:allow scrub-allow\n')
                self.git('add', '.')
                result = self.run_gate('tree')
                self.assert_blocked(result, 'tailscale-credential')
                self.assertNotIn(token, result.stdout + result.stderr)

    def test_legacy_tailscale_auth_and_private_state_keys(self):
        for token in ['tskey-'+'Ab12Cd34'*5,'privkey:'+('a1b2c3d4'*8)]:
            with self.subTest(format=token.split(':')[0][:7]):
                p=self.repo/'state.json';p.write_text(token);self.git('add','.')
                self.assert_blocked(self.run_gate('tree'),'tailscale-')

    def test_private_network_rules_and_safe_examples(self):
        for value in ['taildeadbeef.ts.net', 'host.customname.ts.net', '100.101.102.103', 'fd7a:115c:a1e0::1', '192.168.12.24', '10.12.1.5', '172.20.1.2']:
            with self.subTest(value=value):
                (self.repo / 'network.md').write_text(value + '\n')
                self.git('add', '.')
                self.assert_blocked(self.run_gate('tree'), 'private-')
        (self.repo / 'network.md').write_text('https://host.your-tailnet.ts.net 127.0.0.1 192.0.2.1 8.8.8.8\n')
        self.git('add', '.')
        self.assertEqual(self.run_gate('tree').returncode, 0)

    def test_index_scan_uses_staged_bytes(self):
        p = self.repo / 'example.txt'
        p.write_text('tskey-' + 'auth-' + 'Ab12Cd34' * 5)
        self.git('add', '.')
        p.write_text('clean now, index still leaks')
        self.assert_blocked(self.run_gate('staged'), 'tailscale-credential')

    def test_history_catches_removed_secret(self):
        p = self.repo / 'secret.txt'
        p.write_text('tskey-' + 'api-' + 'Ab12Cd34' * 5)
        self.git('add', '.')
        self.git('commit', '-qm', 'unsafe')
        p.unlink()
        self.git('add', '-u')
        self.git('commit', '-qm', 'remove')
        self.assert_blocked(self.run_gate('history', '--revision', 'HEAD'), 'tailscale-credential')

    def test_history_scans_deleted_image_named_blob(self):
        p=self.repo/'asset.png'
        p.write_text('tskey-'+'auth-'+'Ab12Cd34'*5)
        self.git('add','.')
        self.git('commit','-qm','unsafe binary filename')
        p.unlink();self.git('add','-u');self.git('commit','-qm','remove')
        self.assert_blocked(self.run_gate('history'),'tailscale-credential')

    def test_pre_push_scans_objects_new_to_destination(self):
        # Only the remote already holding this synthetic credential is an
        # acceptable base. A new branch at another remote must still block.
        remote = self.repo.parent / 'destination.git'
        source = self.repo / 'old.txt'
        source.write_text('tskey-' + 'auth-' + 'Ab12Cd34' * 5)
        self.git('add', 'old.txt')
        self.git('commit', '-m', 'existing remote history')
        subprocess.run(['git', 'clone', '-q', '--bare', str(self.repo), str(remote)], check=True)
        self.git('rm', 'old.txt')
        self.git('commit', '-m', 'remove old value')

        def push_input():
            oid = self.git('rev-parse', 'HEAD').decode().strip()
            return f'HEAD {oid} refs/heads/proposal {"0" * 40}\n'

        clean = self.run_gate('pre-push', '--remote', remote, input=push_input())
        self.assertEqual(clean.returncode, 0, clean.stderr)
        self.assert_blocked(self.run_gate('pre-push', input=push_input()), 'tailscale-credential')

        source.write_text('tskey-' + 'auth-' + 'Cd34Ef56' * 5)
        self.git('add', 'old.txt')
        self.git('commit', '-m', 'new value')
        self.assert_blocked(self.run_gate('pre-push', '--remote', remote, input=push_input()),
                            'tailscale-credential')

    def test_pre_push_scans_non_head_branch_and_annotated_tag(self):
        self.git('checkout','-qb','unsafe')
        (self.repo/'secret.txt').write_text('tskey-'+'auth-'+'Ab12Cd34'*5)
        self.git('add','.');self.git('commit','-qm','unsafe')
        oid=self.git('rev-parse','HEAD').decode().strip()
        self.git('tag','-a','unsafe-tag','-m','tag')
        tag=self.git('rev-parse','unsafe-tag').decode().strip()
        self.git('checkout','-q','-')
        for ref,value in [('refs/heads/unsafe',oid),('refs/tags/unsafe-tag',tag)]:
            with self.subTest(ref=ref):
                self.assert_blocked(self.run_gate('pre-push',input=f'{ref} {value} {ref} '+('0'*40)+'\n'),'tailscale-credential')

    def test_shallow_unrelated_branch_does_not_block_complete_head(self):
        original=self.git('rev-parse','HEAD').decode().strip()
        self.git('checkout','--orphan','partial')
        self.git('commit','-qm','orphan root')
        (self.repo/'README.md').write_text('partial child')
        self.git('add','.');self.git('commit','-qm','child')
        boundary=self.git('rev-parse','HEAD').decode().strip()
        self.git('checkout','-q',original)
        (self.repo/'.git/shallow').write_text(boundary+'\n')
        r=self.run_gate('history')
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        self.assert_blocked(self.run_gate('history','--revision','partial'),'shallow')

    def test_exact_privacy_exception_does_not_exempt_other_content(self):
        line = '100.101.102.103'
        p = self.repo / 'example.txt'
        p.write_text(line + '\n')
        self.git('add', '.')
        allow = self.root / 'allow.json'
        allow.write_text(json.dumps([{'path':'example.txt', 'rule':'private-ip',
            'line_sha256':hashlib.sha256(line.encode()).hexdigest(), 'reason':'synthetic networking test'}]))
        self.assertEqual(self.run_gate('--exceptions', allow, 'tree').returncode, 0)
        bundle=self.root/'source.zip'
        rows=json.loads(allow.read_text())
        rows.append({**rows[0],'path':'source.zip!example.txt'})
        allow.write_text(json.dumps(rows))
        with zipfile.ZipFile(bundle,'w') as archive: archive.writestr('example.txt',line+'\n')
        self.assertEqual(self.run_gate('--exceptions',allow,'artifacts',bundle).returncode,0)
        with zipfile.ZipFile(bundle,'w') as archive: archive.writestr('example.txt','100.101.102.104\n')
        self.assert_blocked(self.run_gate('--exceptions',allow,'artifacts',bundle))
        p.write_text('100.101.102.104\n')
        self.assert_blocked(self.run_gate('--exceptions', allow, 'tree'))
        self.assert_blocked(self.run_gate('--exceptions',self.root/'missing-policy.json','tree'))
        allow.write_text('{broken')
        self.assert_blocked(self.run_gate('--exceptions', allow, 'tree'))

    def test_reviewed_fixture_exception_cannot_hide_changed_credential(self):
        token='tskey-'+'auth-'+'Ab12Cd34'*5
        line='fixture = '+token
        p=self.repo/'fixture.txt';p.write_bytes((line+'\n').encode('utf-8'));self.git('add','.')
        self.assert_blocked(self.run_gate('tree'),'tailscale-credential')
        config=self.repo/'security';config.mkdir()
        (config/'reviewed-fixtures.json').write_text(json.dumps([{'path':'fixture.txt',
          'rule':'tailscale-credential','content_sha256':hashlib.sha256((line+'\n').encode()).hexdigest(),
          'reason':'Generated synthetic scanner fixture, never provisioned'}]))
        result=self.run_gate('tree')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        p.write_text(line+'DIFFERENT\n')
        self.assert_blocked(self.run_gate('tree'),'tailscale-credential')
        p.write_text('public text')
        nested=self.repo/'production/fixture.txt';nested.parent.mkdir();nested.write_text(line+'\n')
        self.git('add','.')
        self.assert_blocked(self.run_gate('tree'),'tailscale-credential')

    def test_normalized_scan_bytes_and_fixture_reviews_are_platform_independent(self):
        # Native Windows defaults must not alter the scanner's UTF-8/LF bytes
        # or prevent a reviewed fixture from matching its exact content hash.
        spec=importlib.util.spec_from_file_location('normalized_gate',HERE/'gate.py')
        gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
        token='tskey-'+'auth-'+'Ab12Cd34'*5
        canonical=('label = \u2603\nfixture = '+token+'\n').encode('utf-8')
        review={('fixture.txt','tailscale-credential',hashlib.sha256(canonical).hexdigest())}
        original_write=Path.write_text

        def windows_text_write(path,text,encoding=None,errors=None,newline=None):
            if path.parent.name=='inputs':
                with path.open('w',encoding=encoding or 'cp1252',errors=errors,
                               newline='\r\n' if newline is None else newline) as stream:
                    return stream.write(text)
            return original_write(path,text,encoding=encoding,errors=errors,newline=newline)

        for changed in (False,True):
            work=self.root/('changed' if changed else 'reviewed');work.mkdir()
            scan=gate.Scan(self.repo,work,[],fixture_allow=review)
            data=canonical+b'# changed fixture\n' if changed else canonical
            with mock.patch.object(Path,'write_text',windows_text_write):
                try: scan.add_text(data,'fixture.txt')
                except UnicodeError as error:
                    self.fail('Scanner inherited a platform text encoding: '+str(error))
            self.assertEqual((work/'inputs/00000001.txt').read_bytes(),data)
            scan.leaks(os.environ.get('GITLEAKS_BIN') or shutil.which('gitleaks'))
            if changed: self.assertTrue(any(row['rule']=='tailscale-credential' for row in scan.findings))
            else: self.assertEqual(scan.findings,[])

    def test_artifact_ignores_gitignore_and_scans_nested_archives(self):
        (self.repo / '.gitignore').write_text('release/\n')
        out = self.repo / 'release'
        out.mkdir()
        inner = io.BytesIO()
        with zipfile.ZipFile(inner, 'w') as z:
            z.writestr('credentials.env', 'tskey-' + 'auth-' + 'Ab12Cd34' * 5)
        with tarfile.open(out / 'source.tar.gz', 'w:gz') as t:
            info = tarfile.TarInfo('nested.zip')
            info.size = len(inner.getvalue())
            t.addfile(info, io.BytesIO(inner.getvalue()))
        self.assert_blocked(self.run_gate('artifacts', out), 'tailscale-credential')

    def test_artifact_failure_never_runs_publisher(self):
        bad = self.root / 'bad.txt'
        bad.write_text('tskey-' + 'client-' + 'Ab12Cd34' * 5)
        marker = self.root / 'published'
        r = self.run_gate('publish', '--artifact', bad, '--', sys.executable, '-c',
                          'from pathlib import Path; Path(' + repr(str(marker)) + ').touch()')
        self.assert_blocked(r)
        self.assertFalse(marker.exists())

    def test_clean_artifact_runs_publisher(self):
        clean = self.root / 'ok.txt'
        clean.write_text('public text\n')
        marker = self.root / 'published'
        r = self.run_gate('publish', '--artifact', clean, '--', sys.executable, '-c',
                          'from pathlib import Path; Path(' + repr(str(marker)) + ').touch()')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(marker.exists())

    @unittest.skipIf(hasattr(os,'geteuid') and os.geteuid()==0,'root bypasses file permission checks')
    def test_unreadable_artifact_subtree_is_not_silently_skipped(self):
        root=self.root/'release';root.mkdir();(root/'public.txt').write_text('public')
        hidden=root/'hidden';hidden.mkdir();(hidden/'secret.txt').write_text('tskey-'+'auth-'+'Ab12Cd34'*5)
        hidden.chmod(0)
        try: self.assert_blocked(self.run_gate('artifacts',root),'unreadable')
        finally: hidden.chmod(0o700)

    def test_compressed_tar_expansion_is_bounded(self):
        data=b'X'*(9*1024*1024)
        bundle=self.root/'bomb.tar.gz'
        with tarfile.open(bundle,'w:gz') as t:
            info=tarfile.TarInfo('large.txt');info.size=len(data);t.addfile(info,io.BytesIO(data))
        self.assert_blocked(self.run_gate('artifacts',bundle),'expansion budget')

    def test_missing_scanner_empty_missing_and_malformed_artifacts_fail(self):
        for args in [('tree',), ('artifacts', self.root/'missing'), ('artifacts', self.root/'empty'), ('artifacts', self.root/'bad.zip')]:
            (self.root/'empty').mkdir(exist_ok=True)
            (self.root/'bad.zip').write_bytes(b'not a zip')
            self.assert_blocked(self.run_gate(*args, env={'GITLEAKS_BIN':'/missing/scanner'}))

    def test_symlinks_and_archive_traversal_fail_closed(self):
        link = self.root/'link'
        link.symlink_to(self.repo/'README.md')
        self.assert_blocked(self.run_gate('artifacts', link))
        z = self.root/'unsafe.zip'
        with zipfile.ZipFile(z,'w') as f:
            f.writestr('../escaped.txt', 'clean')
        self.assert_blocked(self.run_gate('artifacts', z))

    @unittest.skipUnless(shutil.which('pdftoppm') and shutil.which('tesseract') and shutil.which('pdftotext'), 'optional publication OCR tools not installed')
    def test_real_pdf_and_screenshot_extraction(self):
        # A standalone one-page PDF with large Helvetica text, built without dependencies.
        content=b'BT /F1 32 Tf 40 700 Td (100.101.102.103) Tj ET'
        objects=[b'<< /Type /Catalog /Pages 2 0 R >>',
          b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
          b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
          b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
          b'<< /Length '+str(len(content)).encode()+b' >>\nstream\n'+content+b'\nendstream']
        data=b'%PDF-1.4\n'; offsets=[0]
        for n,obj in enumerate(objects,1):
            offsets.append(len(data)); data+=str(n).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
        xref=len(data); data+=b'xref\n0 6\n0000000000 65535 f \n'
        data+=b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
        data+=b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+str(xref).encode()+b'\n%%EOF\n'
        pdf=self.root/'network.pdf'; pdf.write_bytes(data)
        self.assert_blocked(self.run_gate('artifacts',pdf),'private-ip')
        subprocess.run(['pdftoppm','-r','150','-png','-singlefile',str(pdf),str(self.root/'screenshot')],check=True,capture_output=True)
        self.assert_blocked(self.run_gate('artifacts',self.root/'screenshot.png'),'private-ip')
        content=b'BT /F1 32 Tf 40 700 Td (public text) Tj ET'
        key='tskey-'+'auth-'+'Ab12Cd34'*5
        objects[-1]=b'<< /Length '+str(len(content)).encode()+b' >>\nstream\n'+content+b'\nendstream'
        objects.append(('<< /Subject ('+key+') >>').encode())
        data=b'%PDF-1.4\n';offsets=[]
        for n,obj in enumerate(objects,1):
            offsets.append(len(data));data+=str(n).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
        xref=len(data);data+=b'xref\n0 7\n0000000000 65535 f \n'
        data+=b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets)
        data+=b'trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n'+str(xref).encode()+b'\n%%EOF\n'
        pdf.write_bytes(data)
        self.assert_blocked(self.run_gate('artifacts',pdf),'tailscale-credential')

    def test_container_layers_retain_deleted_credentials(self):
        layer = io.BytesIO()
        with tarfile.open(fileobj=layer, mode='w') as t:
            data = ('tskey-' + 'api-' + 'Ab12Cd34' * 5).encode()
            info = tarfile.TarInfo('root/secret.txt'); info.size = len(data)
            t.addfile(info, io.BytesIO(data))
            link = tarfile.TarInfo('usr/bin/link'); link.type = tarfile.SYMTYPE
            link.linkname = '/usr/bin/public'; t.addfile(link)
        image = self.root / 'image.tar'
        with tarfile.open(image, 'w') as t:
            data=layer.getvalue(); info=tarfile.TarInfo('layer/layer.tar'); info.size=len(data)
            t.addfile(info,io.BytesIO(data))
            info=tarfile.TarInfo('later/.wh.secret.txt'); info.size=0
            t.addfile(info,io.BytesIO(b''))
        self.assert_blocked(self.run_gate('image-archive', image), 'tailscale-credential')

    def whiteout_image(self, *, payload=b'', character=False):
        image=self.root/'whiteout-image.tar'
        with tarfile.open(image,'w') as archive:
            data=b'{"architecture":"arm64"}'
            info=tarfile.TarInfo('config.json');info.size=len(data)
            archive.addfile(info,io.BytesIO(data))
            info=tarfile.TarInfo('tmp/.wh.deleted-package.whl')
            if character:
                info.type=tarfile.CHRTYPE;info.devmajor=0;info.devminor=0
            else:info.size=len(payload)
            archive.addfile(info,io.BytesIO(payload))
        return image

    def test_container_empty_regular_whiteout_is_metadata_even_with_archive_suffix(self):
        result=self.run_gate('image-archive',self.whiteout_image())
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_container_character_whiteout_is_metadata_even_with_archive_suffix(self):
        result=self.run_gate('image-archive',self.whiteout_image(character=True))
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_container_nonempty_whiteout_fails_closed(self):
        result=self.run_gate('image-archive',self.whiteout_image(payload=b'not metadata'))
        self.assert_blocked(result,'invalid container whiteout metadata')

    def test_source_archive_does_not_receive_container_whiteout_treatment(self):
        self.assert_blocked(self.run_gate('artifacts',self.whiteout_image()))

    def vendor_wav(self, data=b'RIFF synthetic scientific fixture', member='usr/vendor/fixture.wav'):
        image=self.root/'image.tar'
        with tarfile.open(image,'w') as archive:
            info=tarfile.TarInfo(member);info.size=len(data)
            archive.addfile(info,io.BytesIO(data))
        policy=self.repo/'security';policy.mkdir(exist_ok=True)
        row={'path':'image.tar!'+member,'raw_sha256':hashlib.sha256(data).hexdigest(),
             'source_url':'https://files.pythonhosted.org/packages/synthetic/vendor-test.whl',
             'source_sha256':hashlib.sha256(b'synthetic source wheel').hexdigest(),
             'reason':'Synthetic unit fixture; tests exact binary review, no real vendor approval.'}
        reviewed=policy/'reviewed-vendor-media.json'
        reviewed.write_text(json.dumps([row]))
        return image,reviewed,row

    def test_exact_reviewed_vendor_wav_completes_image_scan(self):
        image,_,_=self.vendor_wav()
        result=self.run_gate('image-archive',image)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_changed_reviewed_vendor_wav_remains_unsupported(self):
        image,_,_=self.vendor_wav()
        with tarfile.open(image,'w') as archive:
            data=b'RIFF different scientific fixture';info=tarfile.TarInfo('usr/vendor/fixture.wav');info.size=len(data)
            archive.addfile(info,io.BytesIO(data))
        self.assertEqual(self.run_gate('image-archive',image).returncode,2)

    def test_reviewed_vendor_wav_at_another_path_remains_unsupported(self):
        image,_,_=self.vendor_wav()
        with tarfile.open(image,'w') as archive:
            data=b'RIFF synthetic scientific fixture';info=tarfile.TarInfo('other/fixture.wav');info.size=len(data)
            archive.addfile(info,io.BytesIO(data))
        self.assertEqual(self.run_gate('image-archive',image).returncode,2)

    def test_reviewed_vendor_media_never_skips_credential_or_privacy_scan(self):
        data=('RIFF\n'+'tskey-'+'auth-'+'Ab12Cd34'*5+'\n100.101.102.103\n').encode()
        image,_,_=self.vendor_wav(data)
        result=self.run_gate('image-archive',image)
        self.assertEqual(result.returncode,1,result.stdout+result.stderr)
        self.assertIn('tailscale-credential',result.stderr)
        self.assertIn('private-ip',result.stderr)
        self.assertNotIn(data.decode(),result.stdout+result.stderr)

    def test_ordinary_publication_wav_stays_unsupported_even_when_reviewed(self):
        image,_,_=self.vendor_wav()
        self.assertEqual(self.run_gate('artifacts',image).returncode,2)

    def test_vendor_media_review_requires_provenance(self):
        image,reviewed,row=self.vendor_wav()
        del row['source_sha256'];reviewed.write_text(json.dumps([row]))
        self.assertEqual(self.run_gate('image-archive',image).returncode,2)

    def test_vendor_media_retains_findings_despite_matching_privacy_exception(self):
        data=b'RIFF\n100.101.102.103\n'
        image,_,row=self.vendor_wav(data)
        (self.repo/'security/privacy-exceptions.json').write_text(json.dumps([
            {'path':row['path'],'rule':'private-ip','line_sha256':hashlib.sha256(b'100.101.102.103').hexdigest(),'reason':'Synthetic matching exception, must not hide vendor-media finding'}]))
        result=self.run_gate('image-archive',image)
        self.assertEqual(result.returncode,1,result.stdout+result.stderr)
        self.assertIn('private-ip',result.stderr)

    def test_vendor_media_retains_findings_despite_matching_credential_fixture(self):
        data=('RIFF\n'+'tskey-'+'auth-'+'Ab12Cd34'*5+'\n').encode()
        image,_,row=self.vendor_wav(data)
        (self.repo/'security/reviewed-fixtures.json').write_text(json.dumps([
            {'path':row['path'],'rule':'tailscale-credential','content_sha256':hashlib.sha256(data).hexdigest(),'reason':'Synthetic matching normalized fixture, must not hide vendor-media credential'}]))
        result=self.run_gate('image-archive',image)
        self.assertEqual(result.returncode,1,result.stdout+result.stderr)
        self.assertIn('tailscale-credential',result.stderr)

    def test_vendor_media_archive_boundary_identity_is_not_spoofable(self):
        data=b'RIFF synthetic scientific fixture'
        image,reviewed,row=self.vendor_wav(data)
        row['path']='image.tar!layer.tar!usr/vendor/fixture.wav'
        reviewed.write_text(json.dumps([row]))
        nested=io.BytesIO()
        with tarfile.open(fileobj=nested,mode='w') as layer:
            info=tarfile.TarInfo('usr/vendor/fixture.wav');info.size=len(data)
            layer.addfile(info,io.BytesIO(data))
        with tarfile.open(image,'w') as archive:
            payload=nested.getvalue();info=tarfile.TarInfo('layer.tar');info.size=len(payload)
            archive.addfile(info,io.BytesIO(payload))
        normal=self.run_gate('image-archive',image)
        self.assertEqual(normal.returncode,0,normal.stdout+normal.stderr)
        with tarfile.open(image,'w') as archive:
            info=tarfile.TarInfo('layer.tar!usr/vendor/fixture.wav');info.size=len(data)
            archive.addfile(info,io.BytesIO(data))
        self.assertEqual(self.run_gate('image-archive',image).returncode,2)

    def test_dpkg_alternatives_gzip_link_metadata_is_scanned_as_text(self):
        image=self.root/'image.tar'
        data=b'auto\n/usr/share/man/man7/builtins.7.gz\n\n/usr/share/man/man7/bash-builtins.7.gz\n10\n\n\n'
        with tarfile.open(image,'w') as archive:
            info=tarfile.TarInfo('var/lib/dpkg/alternatives/builtins.7.gz');info.size=len(data)
            archive.addfile(info,io.BytesIO(data))
        result=self.run_gate('image-archive',image)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        with tarfile.open(image,'w') as archive:
            data+=b'100.101.102.103\n';info=tarfile.TarInfo('var/lib/dpkg/alternatives/builtins.7.gz');info.size=len(data)
            archive.addfile(info,io.BytesIO(data))
        self.assert_blocked(self.run_gate('image-archive',image),'private-ip')

    def test_corrupt_gzip_elsewhere_and_nontext_alternatives_remain_blocked(self):
        image=self.root/'image.tar'
        for path,data in [('usr/vendor/bad.gz',b'not gzip'),
                          ('var/lib/dpkg/alternatives/builtins.7.gz',b'auto\n/valid/path\n\x80invalid binary'),
                          ('var/lib/dpkg/alternatives/builtins.7.gz',b'auto\n/invalid/\x80path\n')]:
            with self.subTest(path=path):
                with tarfile.open(image,'w') as archive:
                    info=tarfile.TarInfo(path);info.size=len(data);archive.addfile(info,io.BytesIO(data))
                self.assertEqual(self.run_gate('image-archive',image).returncode,2)

    def test_image_pipeline_never_pushes_an_unsafe_layer(self):
        tools=self.root/'tools'; tools.mkdir()
        vendor=self.repo/'security'; vendor.mkdir()
        for name in ['gate.py','gitleaks.toml','image-gate.sh','dockerignore','privacy-exceptions.json','reviewed-fixtures.json']:
            shutil.copyfile(HERE/name,vendor/name)
        fake=tools/'docker'
        fake.write_text("#!/usr/bin/env python3\n" +
            "import os,sys,shutil\nfrom pathlib import Path\na=sys.argv[1:]\n" +
            "if a[:2]==['image','inspect']: print('sha256:'+'1'*64)\n" +
            "elif a[:1]==['save']:\n assert a[-1]=='sha256:'+'1'*64; shutil.copyfile(os.environ['TEST_IMAGE_TAR'],a[a.index('--output')+1])\n" +
            "elif a[:1]==['tag']: assert a[1]=='sha256:'+'1'*64\n" +
            "elif a[:1]==['push']: Path(os.environ['TEST_PUSH_MARKER']).touch()\n" +
            "elif a[:2]!=['buildx','build']: sys.exit(99)\n")
        fake.chmod(0o755)
        for unsafe in [True,False]:
            with self.subTest(unsafe=unsafe):
                image=self.root/'fixture.tar'; marker=self.root/'pushed'
                marker.unlink(missing_ok=True)
                with tarfile.open(image,'w') as archive:
                    data=(('tskey-'+'auth-'+'Ab12Cd34'*5) if unsafe else 'public image').encode()
                    info=tarfile.TarInfo('layer/public.txt');info.size=len(data)
                    archive.addfile(info,io.BytesIO(data))
                env={**os.environ,'PATH':str(tools)+os.pathsep+os.environ['PATH'],
                     'TEST_IMAGE_TAR':str(image),'TEST_PUSH_MARKER':str(marker)}
                result=subprocess.run(['bash',str(vendor/'image-gate.sh'),'.','Dockerfile','linux/arm64','example:scan','a'*40],
                    cwd=self.repo,env=env,capture_output=True,text=True)
                self.assertEqual(marker.exists(),not unsafe,result.stdout+result.stderr)
                self.assertEqual(result.returncode==0,not unsafe,result.stdout+result.stderr)
                self.assertFalse((self.repo/'Dockerfile.dockerignore').exists())

    def test_source_symlink_scans_link_text_without_following(self):
        p = self.repo/'safe-link'
        p.symlink_to('README.md')
        self.git('add', '.')
        r=self.run_gate('tree')
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)

    def test_base64_encoded_tailscale_key(self):
        key = ('tskey-' + 'api-' + 'Ab12Cd34' * 5).encode()
        p = self.repo/'encoded.txt'
        p.write_bytes(base64.b64encode(key))
        self.git('add', '.')
        self.assert_blocked(self.run_gate('tree'), 'tailscale-credential')

    def animated_gif(self, second_text):
        from PIL import Image, ImageDraw, ImageFont
        frames=[]
        for message in ('Public frame one', second_text):
            frame=Image.new('RGB',(720,160),'white')
            ImageDraw.Draw(frame).text((20,50),message,font=ImageFont.load_default(size=40),fill='black')
            frames.append(frame)
        target=self.root/'demo.gif'
        frames[0].save(target,save_all=True,append_images=frames[1:],duration=100,loop=0,disposal=2,optimize=False)
        return target

    def test_animated_gif_scans_private_text_in_later_frame(self):
        private='.'.join(['100','101','102','103'])
        result=self.run_gate('artifacts',self.animated_gif(private))
        self.assertEqual(result.returncode,1,result.stdout+result.stderr)
        self.assertIn('private-ip',result.stderr)
        self.assertNotIn(private,result.stdout+result.stderr)

    def test_safe_animated_gif_completes_all_frame_extraction(self):
        result=self.run_gate('artifacts',self.animated_gif('Public frame two'))
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_transparent_animated_gif_retains_visible_later_text(self):
        from PIL import Image, ImageDraw, ImageFont
        frames=[]
        for message in ('Public frame one','.'.join(['100','101','102','103'])):
            frame=Image.new('P',(720,160),0)
            # Distinct alpha, identical RGB: dropping alpha hides real text.
            frame.putpalette([0,0,0]*256)
            ImageDraw.Draw(frame).text((20,50),message,font=ImageFont.load_default(size=40),fill=1)
            frames.append(frame)
        target=self.root/'transparent.gif'
        frames[0].save(target,save_all=True,append_images=frames[1:],transparency=0,disposal=2,duration=100,optimize=False)
        result=self.run_gate('artifacts',target)
        self.assertEqual(result.returncode,1,result.stdout+result.stderr)
        self.assertIn('private-ip',result.stderr)

    def test_truncated_later_gif_frame_remains_blocked(self):
        target=self.animated_gif('Public frame two')
        raw=target.read_bytes();target.write_bytes(raw[:len(raw)//2])
        result=self.run_gate('artifacts',target)
        self.assertEqual(result.returncode,2,result.stdout+result.stderr)

    def test_later_gif_frame_ocr_failure_remains_blocked(self):
        target=self.animated_gif('Public frame two')
        tools=self.root/'ocr-tools';tools.mkdir();counter=self.root/'ocr-count'
        fake=tools/'tesseract'
        fake.write_text('#!'+sys.executable+'\nimport os,sys\nfrom pathlib import Path\np=Path(os.environ["TEST_OCR_COUNT"])\nn=int(p.read_text())+1 if p.exists() else 1\np.write_text(str(n))\nif n==2:sys.exit(1)\nprint("Public content")\n')
        fake.chmod(0o755)
        result=self.run_gate('artifacts',target,env={'PATH':str(tools)+os.pathsep+os.environ['PATH'],'TEST_OCR_COUNT':str(counter)})
        self.assertEqual(result.returncode,2,result.stdout+result.stderr)

    def test_real_tutorial_dimensions_fit_decoded_frame_budget(self):
        from PIL import Image
        frames=[]
        for number in range(136):
            frame=Image.new('P',(24,24),0)
            frame.putpalette([0,0,0,255,255,255]+[0,0,0]*254)
            frame.putpixel((number%24,number//24),1)
            frames.append(frame)
        target=self.root/'tutorial.gif'
        frames[0].save(target,save_all=True,append_images=frames[1:],duration=100,disposal=2,optimize=False)
        raw=bytearray(target.read_bytes())
        # The real tutorial's canvas and frame count; tiny subframes keep the
        # fixture compact while still requiring full disposal/compositing.
        raw[6:10]=(1940).to_bytes(2,'little')+(1290).to_bytes(2,'little')
        target.write_bytes(raw)
        with Image.open(target) as image:
            self.assertEqual((image.size,image.n_frames),((1940,1290),136))
        tools=self.root/'ocr-tools';tools.mkdir();fake=tools/'tesseract'
        fake.write_text('#!'+sys.executable+'\nprint("Public content")\n');fake.chmod(0o755)
        result=self.run_gate('artifacts',target,env={'PATH':str(tools)+os.pathsep+os.environ['PATH']})
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def gif_scan_module(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('gif_gate_control',HERE/'gate.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        work=self.root/'scan-work';work.mkdir()
        return module,module.Scan(self.repo,work,())

    def tiny_gif(self, frames=1, later_size=None):
        header=b'GIF89a'+b'\x01\x00\x01\x00\x80\x00\x00'+b'\x00\x00\x00\xff\xff\xff'
        blocks=[]
        for number in range(frames):
            width,height=later_size if number and later_size else (1,1)
            blocks.append(b'\x2c\x00\x00\x00\x00'+width.to_bytes(2,'little')+height.to_bytes(2,'little')+b'\x00\x02\x02\x44\x01\x00')
        return header+b''.join(blocks)+b';'

    def test_gif_incomplete_block_with_final_trailer_is_blocked(self):
        target=self.animated_gif('Public frame two')
        raw=target.read_bytes();target.write_bytes(raw[:-1]+b'\x21\xfe\x05abc;')
        result=self.run_gate('artifacts',target)
        self.assertEqual(result.returncode,2,result.stdout+result.stderr)

    def test_gif_plain_text_graphics_cannot_hide_between_image_frames(self):
        target=self.animated_gif('Public frame two');raw=target.read_bytes()
        extension=b'\x21\x01\x0c'+b'\x00\x00\x00\x00\x10\x00\x10\x00\x08\x08\x00\x01'
        extension+=b'\x03'+b'100'+b'\x0c'+b'.101.102.103'+b'\x00'
        target.write_bytes(raw[:-1]+extension+b';')
        result=self.run_gate('artifacts',target)
        self.assertEqual(result.returncode,2,result.stdout+result.stderr)

    def test_gif_raw_budget_precedes_reading_payload(self):
        from types import SimpleNamespace
        module,scan=self.gif_scan_module()
        class Oversized:
            def stat(self):return SimpleNamespace(st_size=module.MAX_FILE+1)
            def read_bytes(self):raise AssertionError('Oversized payload was read')
        with self.assertRaises(module.GateError):scan.gif(Oversized(),'oversized.gif')

    def test_gif_frame_budget_precedes_decoder_traversal(self):
        from unittest.mock import patch
        module,scan=self.gif_scan_module();target=self.root/'many.gif';target.write_bytes(self.tiny_gif(frames=501))
        with patch('PIL.Image.open',side_effect=AssertionError('Decoder started before frame budget')) as opened:
            with self.assertRaises(module.GateError):scan.gif(target,'many.gif')
        self.assertEqual(opened.call_count,0)

    def test_gif_later_canvas_bounds_precede_decoder_allocation(self):
        from unittest.mock import patch
        module,scan=self.gif_scan_module();target=self.root/'expands.gif';target.write_bytes(self.tiny_gif(frames=2,later_size=(65535,1024)))
        with patch('PIL.Image.open',side_effect=AssertionError('Decoder started before canvas bounds')) as opened:
            with self.assertRaises(module.GateError):scan.gif(target,'expands.gif')
        self.assertEqual(opened.call_count,0)

    def test_unused_legacy_background_requires_one_full_transparent_frame(self):
        from PIL import Image
        from io import BytesIO
        tools=self.root/'legacy-tools';tools.mkdir();fake=tools/'tesseract'
        fake.write_text('#!'+sys.executable+'\nprint("Public content")\n');fake.chmod(0o755)
        for frames in (1,2):
            raw=bytearray(self.tiny_gif(frames=frames));raw[11]=255
            data=bytes(raw[:19])+b'\x21\xf9\x04\x01\x00\x00\x00\x00'+bytes(raw[19:])
            target=self.root/'legacy.gif';target.write_bytes(data)
            if frames==1:
                with Image.open(BytesIO(data)) as image:
                    self.assertEqual(image.convert('RGBA').getpixel((0,0)),(0,0,0,0))
            result=self.run_gate('artifacts',target,env={'PATH':str(tools)+os.pathsep+os.environ['PATH']})
            self.assertEqual(result.returncode,0 if frames==1 else 2,result.stdout+result.stderr)

    def test_gif_pixel_cache_preserves_each_exact_exception_path(self):
        from PIL import Image,ImageDraw,ImageFont
        for kind in ('privacy','credential'):
            with self.subTest(kind=kind):
                frames=[]
                for message in ('A','B','A'):
                    frame=Image.new('RGB',(120,80),'white')
                    ImageDraw.Draw(frame).text((10,10),message,font=ImageFont.load_default(size=40),fill='black')
                    frames.append(frame)
                target=self.root/(kind+'.gif');frames[0].save(target,save_all=True,append_images=frames[1:],duration=100,disposal=2,optimize=False)
                private='.'.join(['100','101','102','103']) if kind=='privacy' else 'tskey-'+'auth-'+'Ab12Cd34'*5
                security=self.repo/'security';security.mkdir(exist_ok=True)
                filename='privacy-exceptions.json' if kind=='privacy' else 'reviewed-fixtures.json'
                row={'path':target.name+'!frame-1','rule':'private-ip' if kind=='privacy' else 'tailscale-credential','reason':'Synthetic first-frame review must not authorize a later path'}
                row['line_sha256' if kind=='privacy' else 'content_sha256']=hashlib.sha256((private if kind=='privacy' else private+'\n').encode()).hexdigest()
                (security/filename).write_text(json.dumps([row]))
                counter=self.root/(kind+'-count');tools=self.root/(kind+'-tools');tools.mkdir();fake=tools/'tesseract'
                fake.write_text('#!'+sys.executable+'\nimport os\nfrom pathlib import Path\np=Path(os.environ["TEST_OCR_COUNT"])\nn=int(p.read_text())+1 if p.exists() else 1\np.write_text(str(n))\nprint(os.environ["TEST_OCR_VALUE"] if n==1 else "Public")\n');fake.chmod(0o755)
                result=self.run_gate('artifacts',target,env={'PATH':str(tools)+os.pathsep+os.environ['PATH'],'TEST_OCR_COUNT':str(counter),'TEST_OCR_VALUE':private})
                self.assertEqual(result.returncode,1,result.stdout+result.stderr)
                self.assertIn('private-ip' if kind=='privacy' else 'tailscale-credential',result.stderr)
                self.assertEqual(int(counter.read_text()),2)

if __name__ == '__main__':
    unittest.main()
