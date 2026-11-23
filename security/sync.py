#!/usr/bin/env python3
"""Synchronize reviewed shared scanner files from the article repo into sibling repos."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

HERE=Path(__file__).resolve().parent
FILES=['sync.py','dockerignore','.gitignore','gate.py','gitleaks.toml','install.py','requirements.txt','test_gate.py','README.md','image-gate.sh']

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--check',action='store_true')
    p.add_argument('repos',nargs='*',type=Path)
    args=p.parse_args()
    manifest={n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in FILES}
    if args.check:
        expected=json.loads((HERE/'shared-manifest.json').read_text())
        if expected!=manifest: raise SystemExit('Shared scanner differs from reviewed manifest; sync from canonical article repo')
    else:
        (HERE/'shared-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    for repo in args.repos:
        dest=repo/'security'
        if args.check:
            for n,h in manifest.items():
                if hashlib.sha256((dest/n).read_bytes()).hexdigest()!=h: raise SystemExit('Shared policy drift: '+str(dest/n))
        else:
            dest.mkdir(exist_ok=True)
            for n in FILES+['shared-manifest.json']:
                shutil.copyfile(HERE/n,dest/n)
            if not (dest/'privacy-exceptions.json').exists(): (dest/'privacy-exceptions.json').write_text('[]\n')
            if not (dest/'reviewed-fixtures.json').exists(): (dest/'reviewed-fixtures.json').write_text('[]\n')
    print('Shared scanner copies verified' if args.check else 'Shared scanner copies synchronized')

if __name__=='__main__': main()
