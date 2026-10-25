#!/usr/bin/env python3
"""Resolve exact-version upstream license evidence. Network: npm registry + raw.githubusercontent.com."""
import csv,json,pathlib,hashlib,urllib.request,re,tomllib,concurrent.futures
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[3]
def get(url):
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'dependency-license-evidence/1'})
  return urllib.request.urlopen(req,timeout=25).read()
 except Exception:return None
def save(p,b):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);return str(p.relative_to(HERE)),hashlib.sha256(b).hexdigest()
def resolve(d):
 name,ver=d['name'],d['version'];dest=HERE/'evidence'/d['ecosystem']/name.replace('/','__')/ver
 result=dict(ecosystem=d['ecosystem'],name=name,version=ver,declared_license=d['declared_license'],status='unresolved',evidence=[])
 if d['ecosystem']=='JavaScript':
  roots=list((ROOT/'node_modules/.pnpm').glob(name.replace('/','+')+'@'+ver+'*/node_modules/'+name)); local=roots[0] if roots else None
  url='https://registry.npmjs.org/'+name+'/'+ver;b=get(url)
  if not b:return result
  save(dest/'npm-metadata.json',b);meta=json.loads(b);repo=meta.get('repository',{});repo=repo.get('url','') if isinstance(repo,dict) else repo
  commit=meta.get('gitHead',''); sub='';result['published_tarball']=meta.get('dist',{});result['metadata_url']=url
 else:
  roots=list(pathlib.Path.home().glob('.cargo/registry/src/*/'+name+'-'+ver));local=roots[0] if roots else None
  if not local:return result
  meta=tomllib.loads((local/'Cargo.toml').read_text())['package'];repo=meta.get('repository','');vcs=json.loads((local/'.cargo_vcs_info.json').read_text()) if (local/'.cargo_vcs_info.json').exists() else {};commit=vcs.get('git',{}).get('sha1','');sub=vcs.get('path_in_vcs','');save(dest/'Cargo.toml',(local/'Cargo.toml').read_bytes());save(dest/'cargo-vcs-info.json',json.dumps(vcs,indent=2).encode())
  archive=next(pathlib.Path.home().glob('.cargo/registry/cache/*/'+name+'-'+ver+'.crate'),None)
  if archive:result['published_tarball']={'url':'https://static.crates.io/crates/'+name+'/'+name+'-'+ver+'.crate','sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}
 result.update(repository=repo,revision=commit,path_in_vcs=sub)
 # Preserve embedded full grants or explicit source-file licensing statements, separately from upstream text.
 if local:
  for f in sorted(local.rglob('*')):
   if not f.is_file() or f.stat().st_size>500000:continue
   try:t=f.read_text()
   except:continue
   if any(s in t for s in ['Permission is hereby granted','Redistribution and use in source','Licensed under','licensed under','Mozilla Public License','Apache License','MIT License']):
    rel,sha=save(dest/'published'/f.relative_to(local),f.read_bytes());result['evidence'].append({'file':rel,'sha256':sha,'source':'published package: '+str(f.relative_to(local)),'kind':'embedded grant or licensing statement'})
 match=re.search(r'github.com[/:]([^/]+/[^/#]+)',repo)
 if match and commit:
  project=match.group(1).removesuffix('.git');dirs=[''];parts=sub.split('/') if sub else []
  for i in range(1,len(parts)+1):dirs.append('/'.join(parts[:i])+'/')
  names=['LICENSE','LICENSE.md','LICENSE.txt','LICENSE-MIT','LICENSE-APACHE','LICENSE-BSD','LICENSE-MIT.txt','LICENSE-APACHE.txt','COPYING','COPYING.md','COPYING.txt','license','license.md','license.txt','License.txt','License.md']
  urls=[('https://raw.githubusercontent.com/'+project+'/'+commit+'/'+p+n,p+n) for p in dirs for n in names]
  def fetch(pair):
   url,path=pair;b=get(url);return url,path,b
  with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
   for url,path,b in pool.map(fetch,urls):
    if b:
     rel,sha=save(dest/'upstream'/path,b);result['evidence'].append({'file':rel,'sha256':sha,'source':url,'kind':'exact upstream license file'})
 if any(e['kind']=='exact upstream license file' for e in result['evidence']):result['status']='resolved exact upstream license'
 elif any('Permission is hereby granted' in (HERE/e['file']).read_text() or 'Redistribution and use in source' in (HERE/e['file']).read_text() for e in result['evidence']):result['status']='resolved published embedded grant'
 elif result['evidence']:result['status']='licensing statement only; full text unresolved'
 return result
if __name__=='__main__':
 deps=[d for d in csv.DictReader(open(HERE.parent/'dependencies.csv')) if 'absent' in d['status']]
 deps += [dict(ecosystem='Rust',name='swift-rs',version='1.0.7',declared_license='MIT OR Apache-2.0'),dict(ecosystem='Rust',name='swift-rs',version='1.0.8',declared_license='MIT OR Apache-2.0'),dict(ecosystem='JavaScript',name='@napi-rs/canvas-darwin-arm64',version='0.1.100',declared_license='MIT')]
 out=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for r in pool.map(resolve,deps):out.append(r);print(r['name'],r['version'],r['status'],flush=True);(HERE/'resolution.json').write_text(json.dumps(out,indent=2)+'\n')
