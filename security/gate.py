#!/usr/bin/env python3
"""Shared fail-closed credential scanner and publication boundary (Python 3.11+)."""
import argparse
import bz2
import contextlib
import gzip
import hashlib
import ipaddress
import io
import json
import lzma
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
VERSION = '8.30.1'
MAX_FILE = 512 * 1024 * 1024
MAX_TOTAL = 20 * 1024 * 1024 * 1024
MAX_FILES = 250000
MAX_DEPTH = 8
HOST = re.compile(r'(?i)\.ts\.net\b')
IP = re.compile(r'(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])')
V6 = re.compile(r'(?i)\bfd7a:115c:a1e0:[0-9a-f:]+')
PRIVATE_NETS=tuple(ipaddress.ip_network(n) for n in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','100.64.0.0/10'])
SAFE_TAILNETS = {'your-tailnet', 'example', 'example-tailnet', 'tailnet-name'}
BLOCKED_NAMES = {'.env', 'credentials.env', 'api-auth.env', 'ts.env', 'kc.lic', 'k4.lic', 'kx.lic'}

class GateError(Exception):
    pass


def gif_structure(data):
    """Bound the complete length-delimited stream before a decoder opens it."""
    if len(data)<13 or data[:6] not in (b'GIF87a',b'GIF89a'):
        raise GateError('Invalid GIF header')
    offset=6
    def take(size):
        nonlocal offset
        end=offset+size
        if end>len(data):
            raise GateError('Truncated GIF block')
        result=data[offset:end];offset=end
        return result
    def byte():return take(1)[0]
    def blocks(required=False):
        count=0
        while True:
            size=byte()
            if not size:
                if required and not count:raise GateError('Empty GIF image data')
                return
            take(size);count+=1
    screen=take(7);width=int.from_bytes(screen[:2],'little');height=int.from_bytes(screen[2:4],'little')
    if not width or not height or width*height>40_000_000:
        raise GateError('GIF pixel budget exceeded or invalid canvas')
    global_colours=(2<<(screen[4]&7)) if screen[4]&128 else 0
    unused_background=bool(global_colours and screen[5]>=global_colours)
    if global_colours:
        take(3*global_colours)
    frames=0;pending_control=False;transparent_index=None
    while True:
        tag=byte()
        if tag==0x3b:
            if offset!=len(data) or not frames or pending_control:
                raise GateError('Invalid GIF trailer or incomplete graphic')
            return width,height,frames
        if tag==0x21:
            extension=byte()
            if extension==0xf9:
                if pending_control or byte()!=4:raise GateError('Invalid GIF graphic control')
                control=take(4)
                if byte()!=0 or control[0]&0xe0 or (control[0]>>2)&7>3:
                    raise GateError('Unsupported GIF graphic control')
                pending_control=True;transparent_index=control[3] if control[0]&1 else None
            elif extension==0xfe:
                blocks()
            elif extension==0xff:
                if byte()!=11:raise GateError('Invalid GIF application header')
                take(11);blocks()
            else:
                # Pillow does not composite plain-text graphics or unknown
                # rendering extensions. No successful prefix may hide them.
                raise GateError('Unsupported GIF graphic extension')
            continue
        if tag!=0x2c:raise GateError('Invalid GIF block type')
        descriptor=take(9);left=int.from_bytes(descriptor[:2],'little');top=int.from_bytes(descriptor[2:4],'little')
        fw=int.from_bytes(descriptor[4:6],'little');fh=int.from_bytes(descriptor[6:8],'little');packed=descriptor[8]
        frames+=1
        if frames>500 or width*height*frames>500_000_000:
            raise GateError('GIF frame or decoded pixel budget exceeded')
        if not fw or not fh or left+fw>width or top+fh>height or packed&0x18:
            raise GateError('Invalid GIF frame bounds')
        colours=2<<(packed&7) if packed&128 else global_colours
        if not colours or transparent_index is not None and transparent_index>=colours:
            raise GateError('Invalid GIF colour table')
        # Legacy static icons may use a sentinel background index. It cannot
        # contribute pixels only for one full-canvas transparent image; every
        # rendered pixel and both real transparency backgrounds are still read.
        if unused_background and not (frames==1 and left==top==0 and fw==width and fh==height and transparent_index is not None):
            raise GateError('Invalid GIF background index')
        if packed&128:take(3*colours)
        if not 2<=byte()<=8:raise GateError('Invalid GIF LZW code size')
        blocks(required=True);pending_control=False;transparent_index=None


def command(args, **kwargs):
    """Never echo child output: scanner and extractor errors can contain secrets."""
    p = subprocess.run(list(map(str,args)), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600, **kwargs)
    if p.returncode:
        raise GateError(f'{Path(str(args[0])).name} failed (exit {p.returncode})')
    return p.stdout


def scanner():
    path = os.environ.get('GITLEAKS_BIN') or shutil.which('gitleaks') or str(Path.home()/'.local/bin'/('gitleaks.exe' if os.name=='nt' else 'gitleaks'))
    if not path:
        raise GateError('Gitleaks missing: run python3 security/install.py')
    if command([path,'version']).decode().strip().lstrip('v') != VERSION:
        raise GateError(f'Gitleaks must be version {VERSION}')
    return path


def exceptions(path, fixtures=False):
    if not path.exists():
        return set()
    rows = json.loads(path.read_text())
    if not isinstance(rows,list):
        raise GateError('exceptions must be a JSON list')
    result=set()
    hash_key='content_sha256' if fixtures else 'line_sha256'
    for row in rows:
        if (set(row) != {'path','rule',hash_key,'reason'} or
            ((not fixtures and row['rule'] not in {'private-ip','private-tailnet','private-pattern'}) or
             (fixtures and not re.fullmatch('[a-z0-9-]+',row['rule']))) or
            not re.fullmatch('[0-9a-f]{64}',row[hash_key]) or not row['reason'].strip() or
            PurePosixPath(row['path']).is_absolute() or '..' in PurePosixPath(row['path']).parts):
            raise GateError('invalid exception (only exact, explained exceptions are allowed)')
        result.add((row['path'],row['rule'],row[hash_key]))
    return result


def reviewed_vendor_media(path):
    """Exact raw-byte scientific WAV provenance, restricted to image archives."""
    if not path.exists():
        return set()
    rows=json.loads(path.read_text())
    if not isinstance(rows,list): raise GateError('vendor media reviews must be a JSON list')
    result=set()
    for row in rows:
        fields={'path','raw_sha256','source_url','source_sha256','reason'}
        if not isinstance(row,dict) or set(row)!=fields or not all(isinstance(v,str) for v in row.values()):
            raise GateError('invalid vendor media provenance review')
        source=urlsplit(row['source_url'])
        name=PurePosixPath(row['path'])
        if (name.is_absolute() or '..' in name.parts or '\\' in row['path'] or
            name.suffix.lower()!='.wav' or not row['reason'].strip() or
            not re.fullmatch('[0-9a-f]{64}',row['raw_sha256']) or
            not re.fullmatch('[0-9a-f]{64}',row['source_sha256']) or
            source.scheme!='https' or source.netloc!='files.pythonhosted.org' or
            not source.path.startswith('/packages/') or not source.path.endswith('.whl') or
            source.query or source.fragment):
            raise GateError('invalid vendor media provenance review')
        result.add((row['path'],row['raw_sha256']))
    return result


def privacy(text, private_patterns=()):
    found=set()
    for match in HOST.finditer(text):
        # Anchor at the suffix to keep minified/binary input scans linear.
        start=match.start()
        while start>0 and text[start-1].isascii() and (text[start-1].isalnum() or text[start-1] in '.-'):
            start-=1
        prefix=text[start:match.start()]
        if prefix and prefix.lower().split('.')[-1] not in SAFE_TAILNETS:
            found.add('private-tailnet')
    if V6.search(text):
        found.add('private-ip')
    for s in IP.findall(text):
        if not s.startswith(('10.','172.','192.168.','100.')): continue
        try:
            ip=ipaddress.ip_address(s)
        except ValueError:
            continue
        if any(ip in network for network in PRIVATE_NETS):
            found.add('private-ip')
    if any(p.search(text) for p in private_patterns):
        found.add('private-pattern')
    return found


def installer_members(listing, *, kind='default', source=None, details=False):
    """Validate every technical-list record before any external extraction."""
    if kind not in {'default', 'msi-compound'}:
        raise GateError('unsupported installer listing kind')
    if kind == 'msi-compound' and (source is None or Path(source).suffix.lower() != '.msi'):
        raise GateError('Compound listing requires an MSI source')
    listing = listing.replace('\r\n', '\n')
    if '\r' in listing or '\ufffd' in listing:
        raise GateError('unreadable installer member listing')
    lines = listing.split('\n')
    if lines.count('----------') != 1:
        raise GateError('installer archive has no unique member listing')
    if kind == 'msi-compound':
        header = lines[:lines.index('----------')]
        if [line for line in header if line.startswith('Type = ')] != ['Type = Compound']:
            raise GateError('Compound listing type mismatch')
    body = '\n'.join(lines[lines.index('----------') + 1:]).strip('\n')
    if not body or any(ord(c) < 32 and c != '\n' for c in body):
        raise GateError('empty or malformed installer member listing')
    reserved = {'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$',
                *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10)),
                *(prefix + i for prefix in ('COM', 'LPT') for i in '¹²³')}
    records = {}; prefixes = {}; names = []; typed_records = []
    for block in body.split('\n\n'):
        fields = {}
        for line in block.split('\n'):
            if ' = ' not in line:
                raise GateError('malformed installer member record')
            key, value = line.split(' = ', 1)
            if not key or key.strip() != key or key in fields:
                raise GateError('duplicate or malformed installer member field')
            fields[key] = value
        if 'Path' not in fields:
            raise GateError('installer member record has no path')
        if {'Symbolic Link', 'Hard Link', 'Copy Link', 'Link', 'Reparse Tag', 'Alternate Stream'} & fields.keys():
            raise GateError('installer link or alternate stream rejected')
        raw = fields['Path']
        name = raw.replace('\\', '/')
        parts = name.split('/')
        if (not name or PureWindowsPath(raw).drive or PureWindowsPath(raw).root
                or any(part in {'', '.', '..'} or part.endswith((' ', '.'))
                       or any(ord(c) < 32 or c in ':<>"|?*\x7f' for c in part)
                       or part.split('.')[0].rstrip(' .').upper() in reserved for part in parts)):
            raise GateError('unsafe installer member path')
        validation_label = name.replace('%', '%25').replace('!', '%21') if kind == 'msi-compound' else name
        Scan.validate_member(validation_label)
        folded = name.casefold()
        if folded in records:
            raise GateError('duplicate installer member path')
        if 'Folder' in fields and fields['Folder'] not in {'+', '-'}:
            raise GateError('invalid installer folder metadata')
        is_directory = fields.get('Folder') == '+' or fields.get('Attributes', '').startswith('D')
        records[folded] = is_directory
        for i in range(1, len(parts) + 1):
            prefix = '/'.join(parts[:i]); key = prefix.casefold()
            if key in prefixes and prefixes[key] != prefix:
                raise GateError('case-aliased installer path rejected')
            prefixes[key] = prefix
        names.append(name)
        typed_records.append({'raw_path': raw, 'path': name, 'directory': is_directory})
    for name in names:
        parts = name.casefold().split('/')
        if any('/'.join(parts[:i]) in records and not records['/'.join(parts[:i])]
               for i in range(1, len(parts))):
            raise GateError('installer file/directory collision rejected')
    return typed_records if details else names


def archive_digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while block := stream.read(1024 * 1024): result.update(block)
    return result.digest()


def extract_7z_checked(source, dest, *, kind='default', tool='7zz', runner=None):
    """Fixed-format list-before-x plan; no caller-supplied extra extraction switches."""
    runner = command if runner is None else runner
    source, dest = Path(source), Path(dest)
    if (kind not in {'default', 'msi-compound'} or source.is_symlink() or not source.is_file()
            or not source.stat().st_size or dest.exists() or dest.is_symlink()):
        raise GateError('invalid archive extraction request')
    if kind == 'msi-compound' and source.suffix.lower() != '.msi':
        raise GateError('Compound extraction requires an MSI source')
    source_digest = archive_digest(source)
    switches = ['-tCompound'] if kind == 'msi-compound' else []
    raw = runner([tool, 'l', '-slt', '-sccUTF-8', *switches, '--', source])
    try: listing = raw.decode('utf-8', errors='strict')
    except UnicodeDecodeError:
        raise GateError('unreadable installer member listing') from None
    records = installer_members(listing, kind=kind, source=source, details=True)
    if archive_digest(source) != source_digest:
        raise GateError('installer changed during preflight')
    dest.mkdir(mode=0o700)
    runner([tool, 'x', '-y', *switches, '-o' + str(dest), '--', source])
    if archive_digest(source) != source_digest:
        raise GateError('installer changed during extraction')
    return records


def compound_scan_inputs(package, dest, records):
    """Injective label mirror plus original raw names; scan both with unchanged Gate."""
    package, dest = Path(package), Path(dest)
    if package.is_symlink() or not package.is_dir() or dest.exists() or dest.is_symlink():
        raise GateError('invalid Compound mirror request')
    expected = {r['path']: r for r in records}
    if not records or len(expected) != len(records):
        raise GateError('invalid Compound records')
    seen = set(); files = []; directories = []
    def unreadable(_error): raise GateError('unreadable Compound metadata')
    for base, dirs, names in os.walk(package, followlinks=False, onerror=unreadable):
        for name in sorted(dirs + names):
            path = Path(base)/name; rel = path.relative_to(package).as_posix()
            mode = path.lstat().st_mode
            if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise GateError('Compound link or special member rejected')
            if rel not in expected:
                if not stat.S_ISDIR(mode) or not any(p.startswith(rel + '/') for p in expected):
                    raise GateError('unexpected Compound extracted member')
            else:
                if stat.S_ISDIR(mode) != expected[rel]['directory']:
                    raise GateError('Compound member type mismatch')
                seen.add(rel)
            if stat.S_ISDIR(mode): directories.append(rel)
            else: files.append((rel, path))
    if seen != set(expected): raise GateError('missing Compound extracted member')
    dest.mkdir(mode=0o700); mirror=dest/'contents'; mirror.mkdir(mode=0o700)
    def encoded(rel):
        return Path(*(part.replace('%', '%25').replace('!', '%21') for part in rel.split('/')))
    for rel in sorted(directories, key=lambda p: (p.count('/'), p)):
        (mirror/encoded(rel)).mkdir(parents=True, exist_ok=True, mode=0o700)
    for rel, path in files:
        before = archive_digest(path)
        target = mirror/encoded(rel); target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with path.open('rb') as reader, target.open('xb') as output: shutil.copyfileobj(reader, output)
        os.chmod(target,0o600)
        if before != archive_digest(target) or before != archive_digest(path):
            raise GateError('Compound member changed during copy')
    metadata=dest/'raw-member-names.txt'
    metadata.write_bytes(b''.join(r['raw_path'].encode('utf-8') + b'\n' for r in records))
    os.chmod(metadata,0o600)
    return mirror, metadata


class Scan:
    def __init__(self, repo, work, allow, fixture_allow=(), vendor_media=()):
        self.repo, self.work, self.allow = repo, work, allow
        self.fixture_allow=set(fixture_allow)
        self.vendor_media=set(vendor_media)
        self.no_exceptions=set()
        self.inputs=work/'inputs'; self.inputs.mkdir()
        self.mapping={}; self.blobs={}; self.findings=[]; self.total=0; self.count=0
        self.container_archive=False
        self.private_patterns=[]
        # CI can inject this ignored file; no private literals enter tracked policy.
        source=os.environ.get('SECRET_GATE_PRIVATE_PATTERNS_FILE')
        if not source:
            candidate=repo/'scripts/scrub-private-patterns.txt'
            if candidate.is_file(): source=str(candidate)
            else:
                common=command(['git','-C',repo,'rev-parse','--git-common-dir']).decode().strip()
                candidate=(repo/common).resolve().parent/'scripts/scrub-private-patterns.txt'
                if candidate.is_file(): source=str(candidate)
        if source:
            p=Path(source)
            if not p.is_file(): raise GateError('private patterns file missing')
            self.private_patterns=[re.compile(s) for s in p.read_text().splitlines() if s.strip() and not s.startswith('#')]

    def finding(self, path, rule, line=1, commit=None, blob=None):
        item={'path':path,'rule':rule,'line':line}
        if commit: item['commit']=commit
        if blob: item['blob']=blob
        self.findings.append(item)

    def add_text(self, data, label, allow_exceptions=True):
        self.total += len(data); self.count += 1
        if len(data)>MAX_FILE or self.total>MAX_TOTAL or self.count>MAX_FILES:
            raise GateError('scan budget exceeded; publication blocked')
        # Flatten names to avoid Gitleaks' default path exclusions for images,
        # lockfiles and vendor directories. Scan printable binary strings too.
        text=data.replace(b'\x00',b'').decode('utf-8',errors='replace')
        text=re.sub(r'[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]', '\n', text)
        # Reviewed fixture hashes bind these normalized bytes on every OS.
        dest=self.inputs/f'{self.count:08d}.txt'; dest.write_text(text,encoding='utf-8',newline='\n')
        self.mapping[dest.name]=label
        if not allow_exceptions:
            self.no_exceptions.add(dest.name)
        for n,line in enumerate(text.splitlines(),1):
            for rule in privacy(line,self.private_patterns):
                # Match exact source paths or exact archive member paths; never strip
                # arbitrary directories or match just a basename/glob.
                candidates={label}
                digest=hashlib.sha256(line.encode()).hexdigest()
                if not allow_exceptions or not any((path,rule,digest) in self.allow for path in candidates):
                    self.finding(label,rule,n)

    def gif(self, path, label):
        # Leptonica rejects animated GIFs. Decode every composited frame to PNG
        # instead; exact duplicate pixel frames may share one OCR result.
        if path.stat().st_size>MAX_FILE:
            raise GateError('GIF raw file budget exceeded')
        with path.open('rb') as stream:
            data=stream.read(MAX_FILE+1)
        if len(data)>MAX_FILE:
            raise GateError('GIF raw file budget exceeded')
        width,height,frames=gif_structure(data)
        try:
            import PIL
            from PIL import Image
        except ImportError:
            raise GateError('GIF scanning requires pinned security/requirements.txt') from None
        if PIL.__version__!='13.0.0':
            raise GateError('GIF decoder version differs from pinned requirements')
        self.add_text(data,label+'!metadata')
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.format!='GIF' or image.size!=(width,height):
                    raise GateError('GIF decoder canvas differs from validated stream')
                cached={}
                with tempfile.TemporaryDirectory(dir=self.work) as directory:
                    target=Path(directory)/'frame.png'
                    for number in range(frames):
                        image.seek(number)
                        if image.size!=(width,height):
                            raise GateError('GIF decoder enlarged the validated canvas')
                        frame=image.convert('RGBA')
                        frame.load()
                        if frame.getextrema()[3]==(255,255):
                            renderings=[('',frame.convert('RGB'))]
                        else:
                            # Both real canvas backgrounds retain light/dark text;
                            # dropping alpha can turn visible glyphs into a blank.
                            renderings=[(name,Image.alpha_composite(
                                Image.new('RGBA',frame.size,colour),frame).convert('RGB'))
                                for name,colour in [('white',(255,255,255,255)),('black',(0,0,0,255))]]
                        for background,rendered in renderings:
                            digest=hashlib.sha256(str(rendered.size).encode()+rendered.tobytes()).digest()
                            if digest not in cached:
                                rendered.save(target,format='PNG')
                                cached[digest]=command(['tesseract',target,'stdout'])
                            suffix='-'+background if background else ''
                            # Reuse OCR work, never another path's policy result.
                            self.add_text(cached[digest],f'{label}!frame-{number+1}{suffix}')
                    try:
                        image.seek(frames)
                    except EOFError:
                        pass
                    else:
                        raise GateError('GIF decoder frame count differs from validated stream')
        except GateError:
            raise
        except Exception:
            raise GateError('GIF frame decoding failed; publication blocked') from None

    def file(self, path, label, publication=False, depth=0):
        if path.is_symlink():
            raise GateError('symlink in scan target; provide resolved publication contents')
        if not path.is_file(): raise GateError('missing or non-regular scan target')
        if depth>MAX_DEPTH: raise GateError('archive depth exceeded')
        if path.stat().st_size>MAX_TOTAL: raise GateError('file exceeds scan size budget')
        name=PurePosixPath(label).name.lower()
        if name in BLOCKED_NAMES or name.endswith(('.p12','.pfx','.key')):
            self.finding(label,'sensitive-filename')
        suffix=path.suffix.lower()
        if publication and suffix in {'.png','.jpg','.jpeg','.tiff','.tif','.bmp','.gif','.webp','.pdf'}:
            if suffix=='.pdf':
                info=command(['pdfinfo',path]).decode(errors='replace')
                self.add_text(info.encode(),label+'!pdf-metadata')
                self.add_text(path.read_bytes(),label+'!raw-pdf')
                pages_match=re.search(r'^Pages:\s+(\d+)',info,re.MULTILINE)
                if not pages_match or not 0<int(pages_match[1])<=500:
                    raise GateError('PDF page budget exceeded or unreadable')
                attached=command(['pdfdetach','-list',path]).decode(errors='replace')
                count=re.match(r'(\d+) embedded files',attached)
                if not count: raise GateError('unreadable PDF attachment list')
                if int(count[1]):
                    for name in re.findall(r'^\d+: (.+)$',attached,re.MULTILINE): self.validate_member(name)
                    with tempfile.TemporaryDirectory(dir=self.work) as d:
                        command(['pdfdetach','-saveall','-o',d,path])
                        self.directory(Path(d),label+'!attachments',True,depth+1)
                # PDF images may hide credentials even when selectable text exists.
                with tempfile.TemporaryDirectory(dir=self.work) as d:
                    command(['pdftoppm','-r','120','-png',path,Path(d)/'page'])
                    pages=sorted(Path(d).glob('*.png'))
                    if not pages: raise GateError('PDF contains no rendered pages')
                    for i,p in enumerate(pages,1):
                        self.add_text(command(['tesseract',p,'stdout']),f'{label}!page-{i}')
                    self.add_text(command(['pdftotext',path,'-']),label)
            elif suffix=='.gif':
                self.gif(path,label)
            else:
                self.add_text(command(['tesseract',path,'stdout']),label+'!ocr')
                self.add_text(path.read_bytes(),label+'!metadata')
        elif publication and suffix in {'.mp4','.mov','.webm','.mp3','.wav','.flac','.ogg','.iso','.deb','.rpm'}:
            if self.container_archive and suffix=='.wav' and path.stat().st_size<=MAX_FILE:
                data=path.read_bytes()
                if (label,hashlib.sha256(data).hexdigest()) in self.vendor_media:
                    # Provenance review does not exempt strings or any scanning rule.
                    self.add_text(data,label,allow_exceptions=False)
                    return
            raise GateError('artifact format requires a separate publication extractor')
        elif publication and suffix=='.dmg':
            if sys.platform!='darwin': raise GateError('DMG scanning requires macOS hdiutil')
            with tempfile.TemporaryDirectory(dir=self.work) as d:
                mount=Path(d)/'mount'; mount.mkdir()
                command(['hdiutil','attach','-readonly','-nobrowse','-noautoopen','-mountpoint',mount,path])
                try: self.directory(mount,label+'!mounted',True,depth+1,allow_dmg_links=True)
                finally: command(['hdiutil','detach',mount])
        elif publication and suffix=='.pkg':
            if sys.platform!='darwin': raise GateError('PKG scanning requires macOS pkgutil')
            with tempfile.TemporaryDirectory(dir=self.work) as d:
                dest=Path(d)/'expanded'
                command(['pkgutil','--expand-full',path,dest])
                self.directory(dest,label+'!expanded',True,depth+1)
        elif publication and suffix in {'.exe','.msi','.7z','.rar'}:
            with tempfile.TemporaryDirectory(dir=self.work) as d:
                # Validate names and links before the external extractor writes anything.
                tool=shutil.which('7z') or shutil.which('7zz') or '7z'
                extracted=Path(d)/'contents'
                extract_7z_checked(path,extracted,tool=tool)
                self.directory(extracted,label+'!unpacked',True,depth+1)
        elif suffix in {'.zip','.docx','.xlsx','.pptx','.jar','.whl','.nupkg','.apk','.aab'}:
            with zipfile.ZipFile(path) as z:
                for m in z.infolist():
                    self.validate_member(m.filename)
                    if stat.S_ISLNK(m.external_attr>>16): raise GateError('archive symlink rejected')
                    if m.is_dir(): continue
                    if m.file_size>min(MAX_FILE,max(8*1024*1024,m.compress_size*200)): raise GateError('archive member expansion budget exceeded')
                    self.member(z.read(m),m.filename,label,publication,depth)
        elif suffix in {'.tar','.tgz'} or path.name.lower().endswith(('.tar.gz','.tar.bz2','.tar.xz')) or (self.container_archive and tarfile.is_tarfile(path)):
            expanded=0
            expansion_limit=min(MAX_TOTAL,max(8*1024*1024,path.stat().st_size*200))
            with tarfile.open(path,'r:*') as t:
                for m in t:
                    expanded+=m.size
                    if expanded>expansion_limit or self.total+m.size>MAX_TOTAL:
                        raise GateError('tar expansion budget exceeded')
                    self.validate_member(m.name)
                    if self.container_archive and PurePosixPath(m.name).name.startswith('.wh.'):
                        # OCI deletion markers carry no file bytes, even when the
                        # deleted name ends in .whl/.zip. Earlier layers still scan.
                        valid_type=m.isfile() or (m.ischr() and m.devmajor==0 and m.devminor==0)
                        if m.size or not valid_type or PurePosixPath(m.name).name=='.wh.':
                            raise GateError('invalid container whiteout metadata')
                        continue
                    if m.isdir(): continue
                    if not m.isfile():
                        if self.container_archive and (m.issym() or m.islnk()):
                            self.add_text(m.linkname.encode(),label+'!'+m.name+'!link-target')
                            continue
                        raise GateError('archive link/device rejected')
                    if m.size>MAX_TOTAL or (m.size>MAX_FILE and not self.container_archive): raise GateError('archive member too large')
                    with t.extractfile(m) as f:
                        with tempfile.TemporaryDirectory(dir=self.work) as d:
                            child=Path(d)/PurePosixPath(m.name).name
                            with child.open('wb') as out: shutil.copyfileobj(f,out,1024*1024)
                            self.file(child,label+'!'+m.name,publication,depth+1)
        elif suffix in {'.gz','.bz2','.xz'}:
            # dpkg names its plain-text alternatives database after the link,
            # including a .gz manpage suffix; this is not compressed content.
            member=PurePosixPath(label.rsplit('!',1)[-1])
            if (self.container_archive and suffix=='.gz' and
                member.parent==PurePosixPath('var/lib/dpkg/alternatives') and
                path.stat().st_size<=64*1024):
                data=path.read_bytes()
                if re.fullmatch(rb'(?:auto|manual)\n/[\x20-\x7e]+\n[\x09\x0a\x0d\x20-\x7e]*',data):
                    self.add_text(data,label)
                    return
            opener={'.gz':gzip.open,'.bz2':bz2.open,'.xz':lzma.open}[suffix]
            limit=min(MAX_FILE,max(8*1024*1024,path.stat().st_size*200))
            with opener(path,'rb') as f: data=f.read(limit+1)
            if len(data)>limit: raise GateError('compressed input expansion budget exceeded')
            self.member(data,path.stem,label,publication,depth)
        else:
            if path.stat().st_size>MAX_FILE: raise GateError('file exceeds scan size budget')
            self.add_text(path.read_bytes(),label)

    def member(self,data,name,label,publication,depth):
        if len(data)>MAX_FILE: raise GateError('archive member too large')
        # Preserve extension for recursive format handling; never extract user paths.
        with tempfile.TemporaryDirectory(dir=self.work) as d:
            p=Path(d)/PurePosixPath(name).name; p.write_bytes(data)
            self.file(p,label+'!'+name,publication,depth+1)

    @staticmethod
    def validate_member(name):
        if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts or '\\' in name or '!' in name:
            raise GateError('unsafe archive member path')

    def directory(self,path,label,publication,depth=0,allow_dmg_links=False):
        before=self.count
        def unreadable(_error): raise GateError('unreadable artifact subtree')
        for base,dirs,files in os.walk(path,followlinks=False,onerror=unreadable):
            for name in dirs+files:
                p=Path(base)/name
                rel=p.relative_to(path).as_posix()
                if p.is_symlink():
                    # Standard .app framework links and DMG Applications shortcut:
                    # internal links point at bytes scanned elsewhere; never follow.
                    target=os.readlink(p)
                    internal=p.resolve().is_relative_to(path.resolve()) and p.resolve().exists()
                    if allow_dmg_links and (internal or (rel=='Applications' and target=='/Applications')): continue
                    raise GateError('symlink in artifact tree')
                if p.is_file(): self.file(p,label+'/'+rel if label else rel,publication,depth)
                elif not p.is_dir(): raise GateError('non-regular artifact member')
        if self.count==before: raise GateError('empty scan target')

    def tree(self,staged=False):
        names=command(['git','-C',self.repo,'ls-files','-z','--cached']).split(b'\0')
        seen=set()
        for raw in names:
            if not raw or raw in seen: continue
            seen.add(raw); name=os.fsdecode(raw); p=self.repo/name
            if staged:
                data=command(['git','-C',self.repo,'show',':'+name])
                with tempfile.TemporaryDirectory(dir=self.work) as d:
                    f=Path(d)/Path(name).name; f.write_bytes(data); self.file(f,name)
            else:
                try: info=p.lstat()
                except FileNotFoundError: continue  # working-tree deletion; history is scanned separately
                if stat.S_ISLNK(info.st_mode):
                    # Git stores link text, never its referent. Scan exactly those bytes.
                    self.add_text(os.readlink(p).encode(),name)
                else: self.file(p,name)
        if not self.count: raise GateError('no tracked files to scan')

    def leaks(self,exe):
        report=self.work/'gitleaks.json'
        args=[exe,'dir',self.inputs,'--config',HERE/'gitleaks.toml','--ignore-gitleaks-allow',
              '--gitleaks-ignore-path',self.work/'no-ignore-file','--max-decode-depth','3',
              '--redact=100','--no-banner','--log-level','error','--report-format','json','--report-path',report]
        p=subprocess.run(list(map(str,args)),capture_output=True,timeout=900)
        if p.returncode not in {0,1} or not report.exists(): raise GateError('Gitleaks failed to produce a report')
        rows=json.loads(report.read_text())
        if p.returncode and not rows: raise GateError('Gitleaks scan failed')
        for row in rows:
            name=Path(row['File']).name
            label=self.mapping.get(name,'unknown')
            if self.fixture_allow and name not in self.no_exceptions:
                digest=hashlib.sha256((self.inputs/name).read_bytes()).hexdigest()
                candidates={label}
                if any((path,row['RuleID'],digest) in self.fixture_allow for path in candidates): continue
            self.finding(label,row['RuleID'],row['StartLine'],blob=self.blobs.get(name))

    def history(self, exe, revision, remote_commits=()):
        for p in self.inputs.iterdir(): p.unlink()
        self.mapping.clear();self.blobs.clear()
        if revision!='--all': command(['git','-C',self.repo,'rev-parse','--verify',revision+'^{commit}'])
        # Scan every reachable blob once, including removed files, binary names,
        # lockfiles, vendor paths and merge-only changes. No default path exclusions.
        args = ['git', '-C', self.repo, 'rev-list', '--objects']
        if remote_commits:
            revisions = [revision, *(f'^{commit}' for commit in remote_commits)]
            objects = command([*args, '--stdin'],
                              input=('\n'.join(revisions)+'\n').encode()).splitlines()
        else:
            objects = command([*args, revision]).splitlines()
        if not objects and remote_commits:
            return
        count_before = self.count
        shallow=Path(command(['git','-C',self.repo,'rev-parse','--git-path','shallow']).decode().strip())
        if not shallow.is_absolute(): shallow=self.repo/shallow
        if shallow.exists():
            boundaries=set(shallow.read_bytes().splitlines())
            if boundaries.intersection(entry.split(b' ',1)[0] for entry in objects):
                raise GateError('selected history is shallow; fetch its missing ancestry first')
        proc=subprocess.Popen(['git','-C',str(self.repo),'cat-file','--batch'],
                              stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        try:
            for entry in objects:
                oid,_,raw_path=entry.partition(b' ')
                if not raw_path: continue  # commits and trees without an associated path
                proc.stdin.write(oid+b'\n');proc.stdin.flush()
                header=proc.stdout.readline().split()
                if len(header)!=3: raise GateError('unreadable historical object')
                size=int(header[2])
                if size>MAX_FILE: raise GateError('historical object exceeds scan budget')
                data=proc.stdout.read(size)
                if len(data)!=size or proc.stdout.read(1)!=b'\n': raise GateError('truncated historical object')
                if header[1]!=b'blob': continue
                path=os.fsdecode(raw_path)
                # Historical archives recurse through the same source-tree reader.
                before=self.count; findings_before=len(self.findings)
                with tempfile.TemporaryDirectory(dir=self.work) as d:
                    f=Path(d)/PurePosixPath(path).name;f.write_bytes(data)
                    self.file(f,path)
                for n in range(before+1,self.count+1): self.blobs[f'{n:08d}.txt']=oid.decode()
                for finding in self.findings[findings_before:]: finding['blob']=oid.decode()
            proc.stdin.close()
            if proc.wait(timeout=30): raise GateError('historical object traversal failed')
        finally:
            if proc.poll() is None: proc.kill();proc.wait()
        if self.count == count_before:
            if remote_commits: return
            raise GateError('no historical blobs found')
        self.leaks(exe)


def advertised_remote_commits(repo, destination):
    # Only trust refs currently advertised by this push destination. Local
    # tracking branches may be stale or refer to a different push URL.
    advertised = command(['git', '-C', repo, 'ls-remote', '--', destination])
    oids = {line.split()[0] for line in advertised.splitlines() if line.strip()}
    if any(not re.fullmatch(rb'[0-9a-f]{40}|[0-9a-f]{64}', oid) for oid in oids):
        raise GateError('invalid remote ref advertisement')
    if not oids:
        return []
    requested = b''.join(oid+b'^{commit}\n' for oid in sorted(oids))
    objects = command(['git', '-C', repo, 'cat-file', '--batch-check'], input=requested)
    return [fields[0].decode() for line in objects.splitlines()
            if len(fields := line.split()) == 3 and fields[1] == b'commit']



def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',type=Path,default=Path.cwd())
    parser.add_argument('--exceptions',type=Path)
    parser.add_argument('--fixture-exceptions',type=Path)
    parser.add_argument('--reviewed-vendor-media',type=Path)
    parser.add_argument('--report',type=Path,help='redacted JSON metadata only')
    sub=parser.add_subparsers(dest='mode',required=True)
    sub.add_parser('tree'); sub.add_parser('staged')
    push=sub.add_parser('pre-push'); push.add_argument('--remote')
    h=sub.add_parser('history'); h.add_argument('--revision',default='HEAD')
    i=sub.add_parser('image-archive'); i.add_argument('paths',nargs='+',type=Path)
    a=sub.add_parser('artifacts'); a.add_argument('paths',nargs='+',type=Path)
    p=sub.add_parser('publish'); p.add_argument('--artifact',action='append',required=True,type=Path); p.add_argument('command',nargs=argparse.REMAINDER)
    args=parser.parse_args()
    repo=args.repo.resolve()
    try:
        exe=scanner()
        if any(p is not None and not p.is_file() for p in [args.exceptions,args.fixture_exceptions,args.reviewed_vendor_media]):
            raise GateError('explicit exception file missing')
        allow=exceptions(args.exceptions or repo/'security/privacy-exceptions.json')
        with tempfile.TemporaryDirectory(prefix='secret-gate-') as d:
            scan=Scan(repo,Path(d),allow,exceptions(args.fixture_exceptions or repo/'security/reviewed-fixtures.json',fixtures=True),
                      reviewed_vendor_media(args.reviewed_vendor_media or repo/'security/reviewed-vendor-media.json'))
            if args.mode=='pre-push':
                commits=set()
                for line in sys.stdin:
                    fields=line.split()
                    if len(fields)!=4 or not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}',fields[1]):
                        raise GateError('malformed pre-push ref update')
                    oid=fields[1]
                    if set(oid)=={'0'}: continue  # deletion publishes no objects
                    commit=command(['git','-C',repo,'rev-parse','--verify',oid+'^{commit}']).decode().strip()
                    commits.add(commit)
                remote_commits = advertised_remote_commits(repo, args.remote) if commits and args.remote else []
                for commit in sorted(commits):
                    scan.history(exe, commit, remote_commits)
            elif args.mode=='history': scan.history(exe,args.revision)
            elif args.mode in {'tree','staged'}: scan.tree(args.mode=='staged'); scan.leaks(exe)
            else:
                scan.container_archive=args.mode=='image-archive'
                for path in (args.paths if args.mode in {'artifacts','image-archive'} else args.artifact):
                    path=path.absolute()
                    if '!' in path.name: raise GateError('ambiguous archive separator in scan target')
                    if path.is_symlink(): raise GateError('symlink scan target')
                    if path.is_dir(): scan.directory(path,path.name,True)
                    else: scan.file(path,path.name,True)
                if not scan.count: raise GateError('empty artifact scan')
                scan.leaks(exe)
            # De-duplicate metadata; no matched contents or credential values leave the process.
            findings=list({json.dumps(f,sort_keys=True):f for f in scan.findings}.values())
            if args.report:
                args.report.parent.mkdir(parents=True,exist_ok=True)
                args.report.write_text(json.dumps({'status':'blocked' if findings else 'passed','findings':findings},indent=2)+'\n')
            for f in findings[:80]:
                print(f"{json.dumps(f['path'])}:{f['line']}: {f['rule']}" + (f" [{f['commit'][:12]}]" if f.get('commit') else ''),file=sys.stderr)
            if findings:
                print(f'secret-gate: BLOCKED ({len(findings)} findings; no values printed)',file=sys.stderr)
                return 1
        print('secret-gate: passed',flush=True)
        if args.mode=='publish':
            cmd=args.command[1:] if args.command[:1]==['--'] else args.command
            if not cmd: raise GateError('publisher command required after --')
            return subprocess.run(cmd,check=False).returncode
        return 0
    except (GateError,OSError,ValueError,KeyError,TypeError,subprocess.TimeoutExpired,zipfile.BadZipFile,tarfile.TarError) as e:
        # Exception messages from libraries may contain source contents: print only our own.
        detail=str(e) if isinstance(e,GateError) else type(e).__name__
        print('secret-gate: ERROR — '+detail+'; publication blocked',file=sys.stderr)
        return 2

if __name__=='__main__':
    sys.exit(main())
