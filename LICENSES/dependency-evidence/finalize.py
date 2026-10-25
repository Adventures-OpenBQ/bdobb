#!/usr/bin/env python3
"""Finalize collected exact-version declarations, preserve notices, and label incorporation accurately."""
import csv,json,pathlib,hashlib,urllib.request,re,tomllib,subprocess
P=pathlib.Path(__file__).resolve().parent;R=P.parents[3]
def save(p,b):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);return {'file':str(p.relative_to(P)),'sha256':hashlib.sha256(b).hexdigest()}
rows=json.loads((P/'resolution.json').read_text())
standard={}
for license in ['MIT','ISC','BSD-2-Clause','BSD-3-Clause','Apache-2.0','MPL-2.0','Zlib']:
 url='https://raw.githubusercontent.com/spdx/license-list-data/v3.26.0/text/'+license+'.txt'
 b=subprocess.check_output(['curl','--silent','--show-error','--fail','--location','--connect-timeout','10','--max-time','30',url]);e=save(P/'standard-license-texts'/(license+'.txt'),b);e['source']=url;standard[license]=e
for d in rows:
 n,v=d['name'],d['version'];dest=P/'evidence'/d['ecosystem']/n.replace('/','__')/v
 if d['ecosystem']=='JavaScript':roots=list((R/'node_modules/.pnpm').glob(n.replace('/','+')+'@'+v+'*/node_modules/'+n))
 else:roots=list(pathlib.Path.home().glob('.cargo/registry/src/*/'+n+'-'+v))
 if n=='swift-rs' and v=='1.0.8':roots=[R/'src-tauri/vendor/swift-rs']
 if roots:
  local=roots[0]
  for f in local.iterdir():
   if f.is_file() and (f.name.lower().startswith(('readme','license','copying','notice','authors','copyright')) or f.name in ['package.json','Cargo.toml','Cargo.toml.orig','.cargo_vcs_info.json']):
    e=save(dest/'published'/f.name,f.read_bytes());e.update(source=('vendored package' if n=='swift-rs' and v=='1.0.8' else 'published exact-version package')+': '+f.name,kind='exact-version declaration, notice, or license');
    if not any(x['file']==e['file'] for x in d['evidence']):d['evidence'].append(e)
  manifest=local/('package.json' if d['ecosystem']=='JavaScript' else 'Cargo.toml')
  meta=json.loads(manifest.read_text()) if d['ecosystem']=='JavaScript' else tomllib.loads(manifest.read_text())['package']
  declaration=meta.get('license');d['exact_manifest_license']=declaration
  if declaration:
   if not d['status'].startswith('resolved'):d['status']='resolved explicit exact-version declaration; standard terms incorporated'
   d['basis']='Exact-version manifest explicitly declares '+str(declaration)+'. Preserve original package notices; standard text is supplied separately and is not represented as an upstream LICENSE file.'
  if n=='swift-rs' and v=='1.0.8':d['status']='resolved vendored full license texts';d['repository']=meta.get('repository');d['basis']='Vendored 1.0.8 contains upstream LICENSE-MIT and LICENSE-APACHE; preserve both unchanged.'
 # Select permissive branch for alternatives; do not imply all alternatives must be accepted.
 expr=d.get('exact_manifest_license') or d['declared_license']
 if isinstance(expr,dict):expr=expr.get('type','')
 selected=next((l for l in ['MIT','ISC','BSD-2-Clause','BSD-3-Clause','Apache-2.0','MPL-2.0','Zlib'] if re.search(r'(?<![A-Za-z-])'+re.escape(l)+r'(?![A-Za-z-])',expr)),None)
 d['standard_license_selected']=selected;d['standard_license_evidence']=standard.get(selected)
(P/'resolution.json').write_text(json.dumps(rows,indent=2)+'\n')
with (P/'resolution.csv').open('w') as f:
 w=csv.DictWriter(f,fieldnames=['ecosystem','name','version','declared_license','exact_manifest_license','status','standard_license_selected','evidence_files','evidence_sha256','repository','revision']);w.writeheader()
 for d in rows:w.writerow({**{k:d.get(k,'') for k in w.fieldnames if not k.startswith('evidence_')},'evidence_files':';'.join(e['file'] for e in d['evidence']),'evidence_sha256':';'.join(e['sha256'] for e in d['evidence'])})
text=['# Supplemental dependency notices\n','These exact-version artifacts supplement the application THIRD_PARTY_NOTICES and its dependency inventory. Preserve this directory with source distributions. License declarations and copyright notices are copied verbatim in evidence files. No copyright holder or year has been invented. Standard texts are clearly separated from upstream files. A declaration-only resolution means the upstream package explicitly selected a standard license, whose terms are included by reference; it does not mean upstream distributed a full license file.\n']
for d in rows:
 text+=['## '+d['name']+' '+d['version']+' ('+d['ecosystem']+')\n',d['status']+'. Declared license: `'+str(d.get('exact_manifest_license') or d['declared_license'])+'`.\n']
 if d.get('basis'):text+=[d['basis']+'\n']
 text+=['Evidence: '+', '.join('['+e['file']+']('+e['file']+')' for e in d['evidence'])+'.\n']
 if d['standard_license_selected']:text+=['Standard terms: ['+d['standard_license_selected']+']('+d['standard_license_evidence']['file']+').\n']
(P/'SUPPLEMENTAL_NOTICES.md').write_text('\n'.join(text))
resolved=sum(d['status'].startswith('resolved') for d in rows)
(P/'report.md').write_text('# Dependency evidence resolution\n\n'+str(resolved)+' of '+str(len(rows))+' reviewed package/version entries resolved. '+str(len(rows)-resolved)+' unresolved.\n\nScope: 75 missing-root-file entries from dependencies.csv, historical swift-rs 1.0.7 and canvas-darwin-arm64 0.1.100, and vendored swift-rs 1.0.8. Exact manifest declarations are distinguished from recovered full grant text. All original author/copyright notices are preserved in evidence rather than inferred. Standard texts come from pinned SPDX license-list-data v3.26.0 and are explicitly labeled.\n\nRequires Python 3.11+ (tomllib). Reproduce: run `python3 resolve.py` then `python3 finalize.py` from this directory (network access required). The initial resolver obtains exact npm version metadata and Rust crate VCS revisions, then fetches root/ancestor license files at those revisions. The finalizer preserves exact published manifests, README files and notices and supplies explicitly declared standard terms.\n\nThis is license evidence, not the complete corresponding source. Preserve original pinned npm tarballs, Cargo .crate archives and local vendored sources, with their lockfiles and build scripts, for each release graph. `published_tarball` in resolution.json records known exact source URLs and integrity/hash information; repository revision identifies matching upstream source. Do not replace exact sources with current main.\n')
with (P/'source-locations.csv').open('w') as f:
 w=csv.writer(f);w.writerow(['ecosystem','name','version','source_url_or_path','integrity_or_sha256','upstream_revision','note'])
 for r in rows:
  a=r.get('published_tarball',{});url=a.get('tarball') or a.get('url');h=a.get('integrity') or a.get('sha256') or a.get('shasum')
  if r['name']=='swift-rs' and r['version']=='1.0.8':url='src-tauri/vendor/swift-rs';h='see application source archive';note='Preserve complete vendored directory, including application modifications, not registry substitute.'
  else:note='Preserve exact original published archive plus matching lockfile; upstream revision supplements archive.'
  w.writerow([r['ecosystem'],r['name'],r['version'],url,h,r.get('revision',''),note])
manifest=[]
for f in sorted(P.rglob('*')):
 if f.is_file() and f.name!='SHA256SUMS':manifest.append(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+str(f.relative_to(P)))
(P/'SHA256SUMS').write_text('\n'.join(manifest)+'\n')
print(resolved,len(rows))
