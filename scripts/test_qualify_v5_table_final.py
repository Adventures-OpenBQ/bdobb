import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest import mock
spec=importlib.util.spec_from_file_location('qualify',Path(__file__).with_name('qualify-v5-table-final-ci.py'))
q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)

class QualificationTests(unittest.TestCase):
    def proof(self):
        return {'result':'PASS','node':'26.10.0','icu':'78.3','containedWorkers':2,
          'invalidBoundDateBlocked':True,'nativeScalarValues':True,'upload':True,
          'foreignOwnerRefused':True,'desktopSpoofRefused':True,'restartReopen':True,'oldSessionUnavailable':True,
          'advertisedScalarFunctions':['LN','SQRT'],'rawFields':{'uploadedRows':3,'uploadedColumns':8,
          'filteredEmptyValues':[101,301],'prototypeValues':[102,302],
          'linkedEmptyValues':[101,301],'chartM1':[100,300],'opaqueRequestWidgetMeasureIdsRejected':True}}

    def test_source_manifest_rejects_old_source_tree_or_archive(self):
        good={'revision':q.SOURCE,'tree':q.TREE,'sourceArchiveSha256':q.ARCHIVE_SHA}
        q.validate_manifest(good)
        for key in good:
            with self.subTest(key=key), self.assertRaises(q.QualificationError):
                q.validate_manifest({**good,key:'0'*len(good[key])})

    def test_complete_linux_counts_derived_with_prior_scope_floor_and_named_regressions(self):
        for count,names in [(80,q.SERVICE_NAMES),(218,q.CORE_NAMES)]:
            good='\n'.join('test '+name+' ... ok' for name in names)+f'\ntest result: ok. {count} passed; 0 failed; 0 ignored;\n'
            self.assertEqual(q.test_count(good,count,names),count)
            expanded=good.replace(f'{count} passed',f'{count+2} passed')
            self.assertEqual(q.test_count(expanded,count,names),count+2)
            for bad in [good.replace(f'{count} passed',f'{count-1} passed'),good.replace(names[-1],'different'),good+'test result: FAILED']:
                with self.assertRaises(q.QualificationError):q.test_count(bad,count,names)

    def test_runtime_requires_actual_raw_subset_chart_strict_ids_and_512m_workers(self):
        q.validate_runtime(self.proof())
        for key,value in [('result','FAILED'),('node','26.9.0'),('icu','78.2'),('containedWorkers',1),
                          ('rawFields',{**self.proof()['rawFields'],'filteredEmptyValues':[21,101,301]}),
                          ('rawFields',{**self.proof()['rawFields'],'opaqueRequestWidgetMeasureIdsRejected':False})]:
            with self.subTest(key=key),self.assertRaises(q.QualificationError):q.validate_runtime({**self.proof(),key:value})
        for key in ['invalidBoundDateBlocked','nativeScalarValues','upload','foreignOwnerRefused','desktopSpoofRefused','restartReopen','oldSessionUnavailable']:
            with self.subTest(key=key),self.assertRaises(q.QualificationError):q.validate_runtime({**self.proof(),key:False})

    def test_native_hosted_architecture_cannot_be_emulated_or_local(self):
        env={'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','RUNNER_OS':'Linux'}
        with mock.patch.dict(os.environ,env,clear=True),mock.patch.object(q.platform,'system',return_value='Linux'):
            with mock.patch.object(q.platform,'machine',return_value='x86_64'):
                q.host_guard('amd64')
                with self.assertRaises(q.QualificationError):q.host_guard('arm64')
            with mock.patch.object(q.platform,'machine',return_value='aarch64'):
                q.host_guard('arm64')
            with mock.patch.dict(os.environ,{'RUNNER_ENVIRONMENT':'self-hosted'}),mock.patch.object(q.platform,'machine',return_value='x86_64'):
                with self.assertRaises(q.QualificationError):q.host_guard('amd64')

    def test_catalog_mount_never_copies_image_data_and_initializer_refuses_nonempty(self):
        mount=q.catalog_mount('v5-table-1244-'+'a'*32)
        self.assertEqual(mount,'type=volume,source=v5-table-1244-'+'a'*32+',target=/var/lib/table-service,volume-nocopy')
        for name in ['existing-user-catalog','v5-table-1244-../bad','v5-table-1244-'+'a'*31]:
            with self.assertRaises(q.QualificationError):q.catalog_mount(name)
        text=Path(__file__).with_name('qualify-v5-table-final-ci.py').read_text()
        self.assertEqual(text.count("'--mount',catalog_mount(volume)"),2)
        self.assertIn('fs.readdirSync(p).length!==0',q.INITIALIZE_CATALOG)
        self.assertLess(q.INITIALIZE_CATALOG.index('chmodSync'),q.INITIALIZE_CATALOG.index('chownSync'))
        self.assertIn("'--cap-drop','ALL','--cap-add','CHOWN'",text)
        self.assertIn("'--user','0:0'",text)

    def test_offline_workflow_is_dispatch_only_pinned_and_no_sdk_build(self):
        root=Path(__file__).resolve().parents[1]
        text=(root/'.github/workflows/v5-table-amd64-qualification.yml').read_text()
        self.assertIn('workflow_dispatch:',text);self.assertNotIn('  push:',text)
        self.assertIn('default: amd64',text)
        self.assertIn('contents: read',text);self.assertNotIn('contents: write',text)
        self.assertIn('repository: Adventures-OpenBQ/bdobb',text)
        self.assertIn(q.PRODUCT,text);self.assertIn(q.BACKEND,text);self.assertIn('fetch-depth: 2',text)
        self.assertNotIn('v4-table-amd64-qualification',text)
        self.assertIn("steps.qualify.outcome == 'success'",text)
        self.assertIn('retention-days: 1',text)
        self.assertNotIn('SDK',Path(__file__).with_name('qualify-v5-table-final-ci.py').read_text())

    def test_v5_exact_roles_and_presentation_regression_are_required(self):
        self.assertEqual(q.SOURCE,'1244589e3d4c32b4736f97c6a011505414baf593')
        self.assertEqual(q.PRODUCT,'75dbcec84ef82f675385dce80879e4d926e89c0a')
        self.assertEqual(q.TREE,'2d7cd23ab5329156841af84ff4fc8ab69178eb79')
        self.assertIn('statement_presentation_follows_overrides_and_matches_typescript',q.CORE_NAMES)

    def test_only_exact_product_metadata_parent_can_supply_locked_code(self):
        offer={'sourceId':q.OFFER,'baseCommit':q.SOURCE,'release':'v5.0.0'}
        q.validate_source_roles(q.PRODUCT,[q.SOURCE],['SOURCE-MANIFEST.json','source-offer.json'],offer)
        for head,parents,changed,value in [(q.SOURCE,[q.SOURCE],['SOURCE-MANIFEST.json','source-offer.json'],offer),
          (q.PRODUCT,['0'*40],['SOURCE-MANIFEST.json','source-offer.json'],offer),
          (q.PRODUCT,[q.SOURCE],['source-offer.json','src/extra.ts'],offer),
          (q.PRODUCT,[q.SOURCE],['SOURCE-MANIFEST.json','source-offer.json'],{**offer,'baseCommit':q.PRODUCT})]:
            with self.assertRaises(q.QualificationError):q.validate_source_roles(head,parents,changed,value)

if __name__=='__main__':unittest.main()
