# Copyright 2026 SecretoftheUniverse.com LLC.
# SPDX-License-Identifier: AGPL-3.0-only
"""Deterministic source archives; generated offers cannot recursively hash themselves."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile

GENERATED = {'source-offer.json', 'SOURCE-MANIFEST.json'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    checksum = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def stage_verified_file(source, target, expected):
    source, target = Path(source), Path(target)
    if file_digest(source) != expected:
        raise ValueError('Dependency input does not match promised checksum')
    if target.exists():
        if file_digest(target) != expected:
            raise ValueError('Existing dependency download has different bytes')
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.hardlink_to(source)
    except OSError:
        shutil.copyfile(source, target)
    if file_digest(target) != expected:
        raise ValueError('Staged dependency download failed integrity verification')
    return target


def entries(root):
    root = Path(root)
    result = []
    for file in sorted(root.rglob('*')):
        name = file.relative_to(root).as_posix()
        parts = PurePosixPath(name).parts
        if parts[0] in {'.git', 'node_modules', 'dist', '.vercel', '.claude'}:
            raise ValueError('Non-source state in payload: ' + name)
        if any((p == '.env' or p.startswith('.env.')) and not p.endswith('.example') for p in parts):
            raise ValueError('Local environment file in payload: ' + name)
        if file.is_symlink():
            target = os.readlink(file)
            if Path(target).is_absolute() or not (file.parent / target).resolve().is_relative_to(root.resolve()):
                raise ValueError('Unsafe source symlink: ' + name)
            result.append({'path': name, 'type': 'symlink', 'mode': 0o777, 'target': target, 'sha256': digest(target.encode())})
        elif file.is_file():
            result.append({'path': name, 'type': 'file', 'mode': 0o755 if file.stat().st_mode & 0o111 else 0o644,
                           'size': file.stat().st_size, 'sha256': digest(file.read_bytes())})
    return result


def tree_identity(root):
    payload = [entry for entry in entries(root) if entry['path'] not in GENERATED]
    return digest(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode())


def validate_offer(offer):
    source = offer.get('sourceId', '')
    release = offer.get('release', '')
    if not re.fullmatch(r'[a-f0-9]{64}', source) or not re.fullmatch(r'v\d+\.\d+\.\d+', release):
        raise ValueError('Invalid release/source identity')
    filename = f'bdobb-{release}-agpl-{source[:12]}-source.tar.gz'
    url = f'https://github.com/Adventures-OpenBQ/bdobb/releases/download/agpl-{release}-{source[:12]}/{filename}'
    if offer.get('archiveFilename') != filename or offer.get('archiveUrl') != url:
        raise ValueError('Source link does not match its version-specific archive')
    if not re.fullmatch(r'[a-f0-9]{40}', offer.get('baseCommit', '')):
        raise ValueError('Invalid base commit')


def make_manifest(root, offer, dependencies):
    validate_offer(offer)
    if tree_identity(root) != offer['sourceId']:
        raise ValueError('Source offer identifies different source bytes')
    return {'schemaVersion': 1, 'repository': 'Adventures-OpenBQ/bdobb', 'release': offer['release'],
            'baseCommit': offer['baseCommit'], 'sourceId': offer['sourceId'],
            'identityExcludes': sorted(GENERATED), 'files': [e for e in entries(root) if e['path'] != 'SOURCE-MANIFEST.json'],
            'thirdPartySources': dependencies, 'publicationStatus': 'prepared-local-not-published'}


def verify_tree(root):
    root = Path(root)
    manifest = json.loads((root / 'SOURCE-MANIFEST.json').read_text())
    offer = json.loads((root / 'source-offer.json').read_text())
    validate_offer(offer)
    actual = [e for e in entries(root) if e['path'] != 'SOURCE-MANIFEST.json']
    if actual != manifest['files']:
        raise ValueError('Source files differ from the archive manifest')
    if tree_identity(root) != manifest['sourceId'] or offer['sourceId'] != manifest['sourceId']:
        raise ValueError('Source identity mismatch')
    if offer['baseCommit'] != manifest['baseCommit'] or offer['release'] != manifest['release']:
        raise ValueError('Source metadata mismatch')
    return manifest


def write_archive(root, destination, prefix):
    root, destination = Path(root), Path(destination)
    if not re.fullmatch(r'[A-Za-z0-9._-]+', prefix):
        raise ValueError('Unsafe archive prefix')
    members = entries(root)
    if destination.resolve().is_relative_to(root.resolve()):
        raise ValueError('Archive must be written outside the source payload')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('wb') as raw:
        with gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0, compresslevel=6) as zipped:
            with tarfile.open(fileobj=zipped, mode='w', format=tarfile.PAX_FORMAT) as archive:
                for entry in members:
                    info = tarfile.TarInfo(prefix + '/' + entry['path'])
                    info.mode, info.uid, info.gid, info.mtime = entry['mode'], 0, 0, 0
                    info.uname = info.gname = ''
                    if entry['type'] == 'symlink':
                        info.type, info.linkname = tarfile.SYMTYPE, entry['target']
                        archive.addfile(info)
                    else:
                        data = (root / entry['path']).read_bytes()
                        info.size = len(data)
                        archive.addfile(info, io.BytesIO(data))
