# Copyright 2026 SecretoftheUniverse.com LLC.
# SPDX-License-Identifier: AGPL-3.0-only
import pathlib,plistlib,unittest
r=pathlib.Path(__file__).resolve().parents[1]
class SceneRegression(unittest.TestCase):
 def test_sdk27_scene_configuration(self):
  p=r/'src-tauri/Info.ios.plist'
  self.assertTrue(p.exists(),'SDK 27 requires a static scene manifest')
  m=plistlib.loads(p.read_bytes())['UIApplicationSceneManifest']
  self.assertIs(m['UIApplicationSupportsMultipleScenes'],True)
  self.assertEqual(m['UISceneConfigurations']['UIWindowSceneSessionRoleApplication'][0]['UISceneDelegateClassName'],'TaoSceneDelegate')
 def test_scene_configuration_survives_return_to_uikit(self):
  p=r/'src-tauri/vendor/tao/src/platform_impl/ios/view.rs'
  self.assertTrue(p.exists(),'Pinned Tao 0.35.3 needs the upstream scene ownership correction')
  body=p.read_text().split('fn configuration_for_connecting_scene_session(',1)[1].split('fn handle_deep_link(',1)[0]
  self.assertIn('Retained::autorelease_ptr(config)',body)
unittest.main()
