Tao 0.35.3, retaining its upstream MIT/Apache-2.0 licenses.

One downstream change in src/platform_impl/ios/view.rs: return the UISceneConfiguration with Retained::autorelease_ptr(config), following https://github.com/tauri-apps/tao/pull/1245. This prevents premature deallocation when scene lifecycle is enabled for SDK 27. Remove when the Tauri dependency accepts a fixed upstream release.
