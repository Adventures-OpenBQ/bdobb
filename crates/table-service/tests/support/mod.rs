#![allow(dead_code)]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use axum::{
    body::{to_bytes, Body},
    http::Request,
    Router,
};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc};
use table_service::{
    http::{router, HttpState},
    sessions::{RuntimeConfig, SessionManager},
    *,
};
use tower::ServiceExt;
pub struct Harness {
    pub app: Router,
    pub manager: Arc<SessionManager>,
    pub catalog: Arc<SourceCatalog>,
    _dir: tempfile::TempDir,
}
pub const TOKEN: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
impl Harness {
    pub fn new(limits: ServiceLimits) -> Self {
        Self::with_observer(limits, None)
    }
    pub fn with_observer(
        limits: ServiceLimits,
        observer: Option<Arc<dyn table_service::sessions::ComputeObserver>>,
    ) -> Self {
        Self::configured(limits, observer, RuntimeConfig::default())
    }
    pub fn configured(
        limits: ServiceLimits,
        observer: Option<Arc<dyn table_service::sessions::ComputeObserver>>,
        runtime: RuntimeConfig,
    ) -> Self {
        Self::configured_worker(limits, observer, runtime, None)
    }
    pub fn configured_worker(
        limits: ServiceLimits,
        observer: Option<Arc<dyn table_service::sessions::ComputeObserver>>,
        runtime: RuntimeConfig,
        worker: Option<PathBuf>,
    ) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let config = CatalogConfig {
            limits: limits.clone(),
            backend_widgets: [(
                "demo".into(),
                [("quotes".into(), ["symbol".into()].into())].into(),
            )]
            .into(),
        };
        let catalog = Arc::new(SourceCatalog::open(dir.path(), config.clone()).unwrap());
        let node = std::process::Command::new(
            std::env::var("TABLE_INGEST_NODE").unwrap_or_else(|_| "node".into()),
        )
        .args(["-p", "process.execPath"])
        .output()
        .unwrap();
        let ingest = Ingestor::new(
            IngestConfig {
                node: PathBuf::from(String::from_utf8(node.stdout).unwrap().trim()),
                entry: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../../server/table-ingest/dist/child.mjs")
                    .canonicalize()
                    .unwrap(),
                backend_config: None,
                max_concurrent_children: 4,
                max_child_heap_mb: 128,
            },
            limits.clone(),
        )
        .unwrap();
        let mut manager = SessionManager::new(
            catalog.clone(),
            ingest,
            limits.clone(),
            runtime,
            pivot_native_worker::WorkerConfig::new(
                worker.unwrap_or_else(|| {
                    PathBuf::from(
                        std::env::var("TABLE_NATIVE_WORKER")
                            .unwrap_or_else(|_| "/target/debug/pivot-native-worker".into()),
                    )
                }),
                512 * 1024 * 1024,
                limits.max_parse_bytes as usize + 4096,
                std::time::Duration::from_secs(limits.max_job_seconds),
            )
            .unwrap()
            .with_max_starting_workers(4)
            .unwrap()
            .with_batch_rows(limits.max_row_block_rows.min(500) as u32)
            .unwrap(),
        )
        .unwrap();
        if let Some(o) = observer {
            manager = manager.with_observer(o);
        }
        let manager = Arc::new(manager);
        let auth = Authenticator::new(AuthConfig {
            desktop_tokens: [(TOKEN.into(), Principal("alice".into()))].into(),
            gateway_token: Some("gggggggggggggggggggggggggggggggg".into()),
        })
        .unwrap();
        let app = router(HttpState::new(Arc::new(auth), manager.clone(), config));
        Self {
            app,
            manager,
            catalog,
            _dir: dir,
        }
    }
    pub async fn call(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        auth: bool,
    ) -> (u16, Value) {
        self.raw(
            method,
            path,
            body.map(|v| v.to_string()).unwrap_or_default(),
            auth,
        )
        .await
    }
    pub async fn raw(&self, method: &str, path: &str, body: String, auth: bool) -> (u16, Value) {
        let mut r = Request::builder()
            .method(method)
            .uri(path)
            .header("content-type", "application/json");
        if auth {
            r = r.header("authorization", format!("Bearer {TOKEN}"));
        }
        self.send(r.body(Body::from(body)).unwrap()).await
    }
    pub async fn send(&self, r: Request<Body>) -> (u16, Value) {
        let r = self.app.clone().oneshot(r).await.unwrap();
        let code = r.status().as_u16();
        let bytes = to_bytes(r.into_body(), 20 * 1024 * 1024).await.unwrap();
        (code, serde_json::from_slice(&bytes).unwrap())
    }
    pub async fn upload(&self, bytes: &[u8]) -> String {
        let r = Request::builder()
            .method("POST")
            .uri("/sources/uploads")
            .header("authorization", format!("Bearer {TOKEN}"))
            .header("idempotency-key", "upload")
            .header("x-upload-filename", "test.csv")
            .header("content-type", "text/csv")
            .body(Body::from(bytes.to_vec()))
            .unwrap();
        let (s, v) = self.send(r).await;
        assert_eq!(s, 200, "{v}");
        v["sourceId"].as_str().unwrap().into()
    }
    pub async fn open_raw(&self, source: &str, locale: &str, protocol: u32) -> (u16, Value) {
        self.call("POST","/sessions",Some(json!({"sourceId":source,"widgetId":"widget","locale":locale,"protocolVersion":protocol,"inputRevision":1})),true).await
    }
    pub async fn open(&self, source: &str, locale: &str, protocol: u32) -> Value {
        let (s, v) = self.open_raw(source, locale, protocol).await;
        assert_eq!(s, 200, "{v}");
        v
    }
    pub async fn command(&self, id: &Value, req: Value, refresh: Option<Value>) -> (u16, Value) {
        let mut env = json!({"sessionId":id["sessionId"],"sourceSnapshotId":id["sourceSnapshotId"],"wire":json!({"protocolVersion":1,"sessionId":1,"request":req}).to_string()});
        if let Some(r) = id.get("resultId") {
            env["resultId"] = r.clone();
        }
        if let Some(r) = refresh {
            env["refresh"] = r;
        }
        self.call(
            "POST",
            &format!("/sessions/{}/commands", id["sessionId"].as_str().unwrap()),
            Some(env),
            true,
        )
        .await
    }
}
pub fn request(kind: &str, model: u64, fields: Value) -> Value {
    let mut q = json!({"kind":kind,"requestId":format!("{kind}-{model}"),"revision":{"widgetId":"widget","input":1,"model":model,"output":model}});
    q.as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());
    q
}
pub fn definition() -> Value {
    json!({"protocolVersion":1,"locale":"en-US","definition":{"table":{},"search":""}})
}
pub fn apply(model: u64) -> Value {
    request(
        "applyModel",
        model,
        json!({"definition":definition(),"selection":{"kind":"none"},"reconcileMissing":false,"provenAbsentIds":[],"runtimeParams":[]}),
    )
}
pub fn wire(v: &Value) -> Value {
    serde_json::from_str(
        v["wire"]
            .as_str()
            .unwrap_or_else(|| panic!("missing wire: {v}")),
    )
    .unwrap()
}
pub fn tagged(value: &Value) -> pivot_core::contract::WireValue {
    use pivot_core::contract::{WireNumber as N, WireValue as W};
    match value {
        Value::Null => W::Null,
        Value::Bool(b) => W::Bool(*b),
        Value::Number(n) => W::F64(
            if n.as_f64().unwrap() == 0.0 && n.as_f64().unwrap().is_sign_negative() {
                N::Special(pivot_core::contract::SpecialNumber::NegativeZero)
            } else {
                N::Finite(n.as_f64().unwrap())
            },
        ),
        Value::String(s) => W::String(s.clone()),
        Value::Array(a) => W::Array(a.iter().map(tagged).collect()),
        Value::Object(o) => W::Record(o.iter().map(|(k, v)| (k.clone(), tagged(v))).collect()),
    }
}
pub fn analytical_definition() -> Value {
    let model = json!({"schemaVersion":1,"enabled":true,"params":{"promotePage":false,"filters":[]},"categories":[{"id":"cat","name":"Category","sourceFieldId":"y","transform":"native"}],"measures":[{"id":"measure","sourceFieldId":"x","aggregation":"sum"}],"formulas":[],"layout":{"rows":["cat"],"columns":[],"values":["measure"]},"checklists":[],"resultFilters":[],"subtotals":{"grandTotal":true,"groups":true}});
    let mut d = definition();
    d["definition"]["analytical"] = model.clone();
    d["analyticalRecipeSource"] = serde_json::to_value(tagged(&model)).unwrap();
    d
}
