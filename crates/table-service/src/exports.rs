// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! A result pin and one cached batch; disposal cancels its unique native transfer.
use crate::{
    sessions::{Identity, Published, Reply, Slot},
    Principal,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
pub(crate) struct Export {
    pub _slot: Slot,
    pub owner: Principal,
    pub identity: Identity,
    pub published: Arc<Published>,
    pub expires: Instant,
    pub transfer_id: String,
    pub native_id: String,
    pub request_id: String,
    pub fingerprint: String,
    pub closed: AtomicBool,
    pub cleaned: AtomicBool,
    pub state: Mutex<ExportState>,
}
#[derive(Default)]
pub(crate) struct ExportState {
    pub sequence: u64,
    pub last: Option<Reply>,
    pub final_batch: bool,
}
impl Export {
    pub fn close(&self) {
        self.closed.store(true, Ordering::Release);
        if !self.cleaned.swap(true, Ordering::AcqRel) {
            let wire=serde_json::json!({"protocolVersion":1,"sessionId":1,"request":{"kind":"cancel","requestId":"cleanup","revision":self.published.revision,"targetRequestId":self.native_id}}).to_string();
            let _ = self
                .published
                .native
                .lock()
                .unwrap()
                .session
                .dispatch_wire(&wire);
        }
    }
}
impl Drop for Export {
    fn drop(&mut self) {
        self.close();
    }
}
