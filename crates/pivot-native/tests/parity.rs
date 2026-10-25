#![allow(clippy::result_large_err)]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Reuse the entire reviewed frozen oracle runner: structure, identities, recipes,
// Statement/fiscal diagnostics, selection traces, transfers, facets and numerics.
#[path = "../../pivot-core/tests/support/mod.rs"]
mod support;
use pivot_core::{contract::*, session::*};
use pivot_native::{NativeOrder, NativeSession};
use support::*;
struct Host;
impl pivot_core::ordering::ValueOrder for Host {
    fn compare(&self, a: &WireValue, b: &WireValue) -> Result<std::cmp::Ordering, Diagnostic> {
        NativeOrder::new("en-US")?.compare(a, b)
    }
    fn compare_recipe(&self, a: &str, b: &str) -> Result<std::cmp::Ordering, Diagnostic> {
        NativeOrder::new("en-US")?.compare_recipe(a, b)
    }
    fn sort_permutation(
        &self,
        values: &[Vec<WireValue>],
        descending: &[bool],
    ) -> Result<Vec<usize>, Diagnostic> {
        NativeOrder::new("en-US")?.sort_permutation(values, descending)
    }
}
// The shared oracle expects core's two-argument dispatch. This test-only facade
// routes every session request through the production NativeSession instead.
struct Session(NativeSession);
impl Session {
    fn new(locale: String, limits: ResourceLimits) -> Self {
        Self(NativeSession::new(&locale, limits).unwrap())
    }
    fn dispatch(
        &mut self,
        request: CoreRequest,
        _: &dyn pivot_core::ordering::ValueOrder,
    ) -> CoreResponse {
        self.0.dispatch(request)
    }
    fn register(&mut self, input: SourceDataset, input_revision: u64) -> Result<(), Diagnostic> {
        match self
            .0
            .dispatch(CoreRequest {
                request_id: "register".into(),
                revision: revision(1),
                operation: Operation::RegisterInput {
                    input,
                    input_revision,
                },
            })
            .result
        {
            Response::Registered => Ok(()),
            Response::Error(e) => Err(e),
            _ => panic!("registration"),
        }
    }
    fn set_batch_rows(&mut self, rows: u32) -> Result<(), Diagnostic> {
        self.0.set_batch_rows(rows)
    }
}
fn revision(model: u64) -> Revision {
    Revision {
        widget_id: "oracle".into(),
        input: 1,
        model,
        output: model,
    }
}
fn call(s: &mut Session, model: u64, operation: Operation) -> Response {
    s.0.dispatch(CoreRequest {
        request_id: "q".into(),
        revision: revision(model),
        operation,
    })
    .result
}
fn apply(s: &mut Session, d: ValidatedDefinition, runtime: RuntimeParams, model: u64) -> Response {
    call(
        s,
        model,
        Operation::ApplyModel {
            definition: d,
            selection: SelectionSpec::None,
            reconcile_missing: false,
            previous_selection_namespace: None,
            proven_absent_ids: vec![],
            runtime_params: runtime,
        },
    )
}
#[path = "../../pivot-core/tests/session/oracle.rs"]
mod frozen;

// Service-owned sessions may move into a worker, but each retains one owner.
#[test]
fn native_session_can_move_to_an_execution_worker() {
    let session = NativeSession::new("en-US", ResourceLimits::default()).unwrap();
    let usage = std::thread::spawn(move || session.resource_usage())
        .join()
        .unwrap();
    assert_eq!(usage.input_rows, 0);
}
