#!/usr/bin/env python3
"""Install the pinned Gitleaks binary; hashes are reviewed, never fetched at runtime."""
import argparse
import hashlib
import io
import os
from pathlib import Path
import platform
import tarfile
import urllib.request
import zipfile

VERSION='8.30.1'
SHA256={
'darwin_arm64':'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
'darwin_x64':'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
'linux_arm64':'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
'linux_x64':'551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
'windows_arm64':'b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f',
'windows_x64':'d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e',
}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dir',type=Path,default=Path.home()/'.local/bin')
    args=parser.parse_args()
    system=platform.system().lower(); machine=platform.machine().lower()
    arch={'aarch64':'arm64','arm64':'arm64','amd64':'x64','x86_64':'x64'}.get(machine)
    key=f'{system}_{arch}'
    if key not in SHA256: raise SystemExit('Unsupported platform; publication remains blocked')
    ext='zip' if system=='windows' else 'tar.gz'
    filename=f'gitleaks_{VERSION}_{key}.{ext}'
    with urllib.request.urlopen(f'https://github.com/gitleaks/gitleaks/releases/download/v{VERSION}/{filename}',timeout=120) as response:
        data=response.read(32*1024*1024)
    if hashlib.sha256(data).hexdigest()!=SHA256[key]: raise SystemExit('Gitleaks checksum mismatch')
    binary='gitleaks.exe' if system=='windows' else 'gitleaks'
    if ext=='zip':
        with zipfile.ZipFile(io.BytesIO(data)) as archive: contents=archive.read(binary)
    else:
        with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive: contents=archive.extractfile(binary).read()
    args.dir.mkdir(parents=True,exist_ok=True)
    temp=args.dir/(binary+'.tmp'); temp.write_bytes(contents); temp.chmod(0o755)
    dest=args.dir/binary; os.replace(temp,dest)
    print(f'Installed checksum-verified Gitleaks {VERSION}: {dest}')

if __name__=='__main__': main()
