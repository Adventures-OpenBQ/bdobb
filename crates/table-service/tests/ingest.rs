// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use std::path::{Path, PathBuf};
use table_service::{
    CatalogConfig, ErrorCode, IngestConfig, Ingestor, Principal, ServiceLimits, SourceCatalog,
    UploadMetadata,
};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}
fn config(entry: PathBuf) -> IngestConfig {
    IngestConfig {
        node: PathBuf::from(std::env::var("TABLE_INGEST_NODE").unwrap_or_else(|_| {
            let output = std::process::Command::new("node")
                .args(["-p", "process.execPath"])
                .output()
                .expect("Node 26 runtime");
            assert!(output.status.success());
            String::from_utf8(output.stdout).unwrap().trim().to_owned()
        })),
        entry,
        backend_config: None,
        max_concurrent_children: 1,
        max_child_heap_mb: 128,
    }
}
fn catalog(path: &Path) -> SourceCatalog {
    SourceCatalog::open(path, CatalogConfig::default()).unwrap()
}
fn upload(c: &SourceCatalog, name: &str, data: &[u8]) -> table_service::SourceLease {
    let p = Principal("alice".into());
    let s = c
        .create_upload(
            &p,
            "key",
            UploadMetadata {
                filename: name.into(),
                media_type: "application/octet-stream".into(),
            },
            data,
        )
        .unwrap();
    c.acquire(&p, &s.source_id).unwrap()
}
fn fixture(script: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("child.mjs");
    std::fs::write(&path, script).unwrap();
    (dir, path)
}
#[test]
fn actual_parser_preserves_source_and_tagged_values() {
    let dir = tempfile::tempdir().unwrap();
    let c = catalog(dir.path());
    let lease = upload(&c, "source.json", br#"[{"x":12,"a.b":true},{"x":null}]"#);
    let i = Ingestor::new(
        config(root().join("server/table-ingest/dist/child.mjs")),
        ServiceLimits::default(),
    )
    .unwrap();
    let d = i.ingest(&lease, "widget", 2).unwrap();
    assert_eq!(d.rows.len(), 2);
    assert_eq!(d.result_revision, 2);
    assert_eq!(d.columns[1].id, "a.b");
    assert_eq!(
        serde_json::to_value(&d.rows[0].values["x"]).unwrap(),
        serde_json::json!({"tag":"f64","value":12.0})
    );
    assert_eq!(
        lease.read_upload().unwrap(),
        br#"[{"x":12,"a.b":true},{"x":null}]"#
    );
}
#[test]
fn xlsx_zip_bomb_is_refused_without_inflating_it() {
    let (dir, scratch) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let bomb = scratch.path().join("bomb.xlsx");
    let status = std::process::Command::new(&config(PathBuf::new()).node)
        .arg(root().join("server/table-ingest/zipBomb.fixture.mjs"))
        .arg((1u64 << 30).to_string())
        .arg(&bomb)
        .status()
        .unwrap();
    assert!(status.success());
    let data = std::fs::read(&bomb).unwrap();
    assert!(
        data.len() < 2 << 20,
        "1 GiB of sheet XML from {} bytes",
        data.len()
    );
    let c = catalog(dir.path());
    let lease = upload(&c, "bomb.xlsx", &data);
    let i = Ingestor::new(
        config(root().join("server/table-ingest/dist/child.mjs")),
        ServiceLimits::default(),
    )
    .unwrap();
    assert_eq!(
        i.ingest(&lease, "w", 1).unwrap_err().code,
        ErrorCode::InvalidInput
    );
    // Largest reaped child, this test binary's others included. Unguarded, the
    // ingest child's RSS passed 1 GiB inflating the sheet.
    let mut usage = unsafe { std::mem::zeroed::<libc::rusage>() };
    assert_eq!(
        unsafe { libc::getrusage(libc::RUSAGE_CHILDREN, &mut usage) },
        0
    );
    let rss = usage.ru_maxrss as u64 * if cfg!(target_os = "macos") { 1 } else { 1024 };
    assert!(rss < 512 << 20, "child peak RSS {rss} bytes");
}
#[test]
fn failed_parse_keeps_upload_available_for_retry_without_content_in_errors() {
    let dir = tempfile::tempdir().unwrap();
    let c = catalog(dir.path());
    let principal = Principal("alice".into());
    let source = c
        .create_upload(
            &principal,
            "retry",
            UploadMetadata {
                filename: "private.json".into(),
                media_type: "application/json".into(),
            },
            &b"private secret"[..],
        )
        .unwrap();
    let i = Ingestor::new(
        config(root().join("server/table-ingest/dist/child.mjs")),
        ServiceLimits::default(),
    )
    .unwrap();
    for _ in 0..2 {
        let lease = c.acquire(&principal, &source.source_id).unwrap();
        let e = i.ingest(&lease, "w", 1).unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidInput);
        assert!(!e.message.contains("private"));
        assert_eq!(lease.read_upload().unwrap(), b"private secret");
    }
}
#[test]
fn rejects_truncated_oversized_extra_frames_exit_and_stderr_flood() {
    for script in [
        "process.stdout.write(Buffer.from([0,0,0,10,123]));",
        "process.stdout.write(Buffer.from([255,255,255,255]));",
        "process.stdout.write(Buffer.from([0,0,0,2,123,125,0]));",
        "process.exit(7);",
        "process.stderr.write('private secret'.repeat(10000));",
        "process.stdout.write(Buffer.alloc(100000,65));",
    ] {
        let (_dir, path) = fixture(script);
        let dir = tempfile::tempdir().unwrap();
        let c = catalog(dir.path());
        let lease = upload(&c, "a.json", b"[]");
        let i = Ingestor::new(config(path), ServiceLimits::default()).unwrap();
        let error = i.ingest(&lease, "w", 1).unwrap_err();
        assert!(!error.message.contains("private"));
        assert_eq!(lease.read_upload().unwrap(), b"[]");
    }
}
#[test]
fn malformed_tagged_values_never_become_a_dataset() {
    let script = r#"process.stdin.resume(); process.stdin.on('end',()=>{const s=JSON.stringify({protocolVersion:1,sessionId:0,request:{kind:'registerInput',requestId:'ingest',revision:{widgetId:'w',input:1,model:0,output:0},inputRevision:1,input:{rows:[{id:'r',values:{x:{tag:'f64',value:'private secret'}}}],columns:[{id:'x',label:'x'}],resultRevision:1,outputRevision:1,provenance:{sourceWidgetId:'w'},completeness:{kind:'complete',warnings:[]},freshness:{availability:'available',stale:false}}}});const b=Buffer.from(s);const h=Buffer.alloc(4);h.writeUInt32BE(b.length);process.stdout.write(Buffer.concat([h,b]));});"#;
    let (_dir, path) = fixture(script);
    let dir = tempfile::tempdir().unwrap();
    let c = catalog(dir.path());
    let lease = upload(&c, "a.json", b"[]");
    let i = Ingestor::new(config(path), ServiceLimits::default()).unwrap();
    assert_eq!(
        i.ingest(&lease, "w", 1).unwrap_err().code,
        ErrorCode::InvalidInput
    );
}
#[test]
fn native_deadline_kills_blocked_child_and_releases_admission() {
    let (_dir, path) = fixture("setInterval(()=>{},1000);");
    let dir = tempfile::tempdir().unwrap();
    let c = catalog(dir.path());
    let lease = upload(&c, "a.json", b"[]");
    let limits = ServiceLimits {
        max_job_seconds: 1,
        ..Default::default()
    };
    let i = Ingestor::new(config(path), limits).unwrap();
    let start = std::time::Instant::now();
    for _ in 0..2 {
        assert_eq!(
            i.ingest(&lease, "w", 1).unwrap_err().code,
            ErrorCode::LimitExceeded
        );
    }
    assert!(start.elapsed() < std::time::Duration::from_secs(4));
}
#[test]
fn native_rejects_row_column_and_wire_byte_limits_without_publishing_partial_input() {
    for limits in [
        ServiceLimits {
            max_input_rows: 1,
            ..Default::default()
        },
        ServiceLimits {
            max_input_columns: 1,
            ..Default::default()
        },
        ServiceLimits {
            max_parse_bytes: 4,
            ..Default::default()
        },
        ServiceLimits {
            max_upload_bytes: 1,
            ..Default::default()
        },
    ] {
        let dir = tempfile::tempdir().unwrap();
        let c = catalog(dir.path());
        let lease = upload(&c, "a.json", br#"[{"x":1,"y":2},{"x":3}]"#);
        let i = Ingestor::new(
            config(root().join("server/table-ingest/dist/child.mjs")),
            limits,
        )
        .unwrap();
        assert!(i.ingest(&lease, "w", 1).is_err());
        assert!(lease.read_upload().is_ok());
    }
}
#[test]
fn actual_backend_child_uses_private_config_and_preserves_fiscal_evidence() {
    use std::{
        collections::{BTreeMap, BTreeSet},
        io::{Read, Write},
        net::TcpListener,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut request = [0; 8192];
        let n = stream.read(&mut request).unwrap();
        let text = std::str::from_utf8(&request[..n]).unwrap();
        assert!(text.starts_with("GET /table?symbol=AAPL HTTP/1.1\r\n"));
        assert!(text
            .to_ascii_lowercase()
            .contains("authorization: bearer private-token"));
        let body = r#"[{"value":12}]"#;
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
    });
    let dir = tempfile::tempdir().unwrap();
    let private_config = dir.path().join("operator.json");
    let context = serde_json::json!({"maxBytes":10000,"maxRows":100,"maxColumns":10,"timeoutMs":2000,"backends":{"backend":{"widgets":{"financials":{"url":format!("http://127.0.0.1:{port}/table"),"headers":{"Authorization":"Bearer private-token"},"parameters":["symbol"],"response":{"kind":"rows","columns":[{"id":"value","label":"Revenue","metadata":{"fiscalYearEndMonth":9}}],"provenance":{"sourceWidgetId":"financials","sourceKind":"backend","metadata":{"fiscalYearEndMonth":9}},"completeness":{"kind":"partial","warnings":["cap"],"totalRowCount":300,"totalRowCountKind":"exact"}}}}}}});
    std::fs::write(&private_config, serde_json::to_vec(&context).unwrap()).unwrap();
    let catalog_config = CatalogConfig {
        backend_widgets: BTreeMap::from([(
            "backend".into(),
            BTreeMap::from([("financials".into(), BTreeSet::from(["symbol".into()]))]),
        )]),
        ..Default::default()
    };
    let catalog = SourceCatalog::open(dir.path().join("sources"), catalog_config).unwrap();
    let p = Principal("alice".into());
    let source = catalog
        .register_backend(
            &p,
            "backend",
            table_service::BackendBinding {
                backend_id: "backend".into(),
                widget_id: "financials".into(),
                params: BTreeMap::from([("symbol".into(), serde_json::json!("AAPL"))]),
            },
        )
        .unwrap();
    let mut cfg = config(root().join("server/table-ingest/dist/child.mjs"));
    cfg.backend_config = Some(private_config);
    let ingestor = Ingestor::new(cfg, ServiceLimits::default()).unwrap();
    let input = ingestor
        .ingest(
            &catalog.acquire(&p, &source.source_id).unwrap(),
            "target",
            5,
        )
        .unwrap();
    server.join().unwrap();
    assert_eq!(input.result_revision, 5);
    assert_eq!(input.rows.len(), 1);
    assert_eq!(input.columns[0].label, "Revenue");
    assert_eq!(
        serde_json::to_value(input.provenance.metadata.unwrap()["fiscalYearEndMonth"].clone())
            .unwrap(),
        serde_json::json!({"tag":"f64","value":9.0})
    );
    assert_eq!(input.completeness.total_row_count, Some(300));
    assert!(!serde_json::to_string(&input.columns)
        .unwrap()
        .contains("private-token"));
}
#[test]
fn admission_is_shared_by_clones_and_failure_releases_slot() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("ready");
    let release = dir.path().join("release");
    let script=format!("import fs from 'node:fs';fs.writeFileSync({},'ready');setInterval(()=>{{if(fs.existsSync({}))process.exit(3);}},10);",serde_json::to_string(&marker).unwrap(),serde_json::to_string(&release).unwrap());
    let (_fixture, path) = fixture(&script);
    let storage = tempfile::tempdir().unwrap();
    let c = catalog(storage.path());
    let lease = upload(&c, "a.json", b"[]");
    let i = Ingestor::new(config(path), ServiceLimits::default()).unwrap();
    let clone = i.clone();
    let running = std::thread::spawn(move || clone.ingest(&lease, "w", 1));
    let start = std::time::Instant::now();
    while !marker.exists() {
        assert!(start.elapsed() < std::time::Duration::from_secs(5));
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    let lease = upload(&c, "a.json", b"[]");
    assert_eq!(
        i.ingest(&lease, "w", 1).unwrap_err().code,
        ErrorCode::LimitExceeded
    );
    std::fs::write(release, []).unwrap();
    assert_eq!(
        running.join().unwrap().unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        i.ingest(&lease, "w", 1).unwrap_err().code,
        ErrorCode::InvalidInput
    );
}
#[test]
fn invalid_tagged_metadata_is_refused_before_returning_any_dataset() {
    let input = serde_json::json!({"protocolVersion":1,"sessionId":0,"request":{"kind":"registerInput","requestId":"ingest","revision":{"widgetId":"w","input":1,"model":0,"output":0},"inputRevision":1,"input":{"rows":[],"columns":[],"resultRevision":1,"outputRevision":1,"provenance":{"sourceWidgetId":"w","metadata":{"fiscal":{"tag":"bigint-string","value":"01"}}},"completeness":{"kind":"complete","warnings":[]},"freshness":{"availability":"available","stale":false}}}});
    let script=format!("process.stdin.resume();process.stdin.on('end',()=>{{const b=Buffer.from({});const h=Buffer.alloc(4);h.writeUInt32BE(b.length);process.stdout.write(Buffer.concat([h,b]));}});",serde_json::to_string(&input.to_string()).unwrap());
    let (_dir, path) = fixture(&script);
    let storage = tempfile::tempdir().unwrap();
    let c = catalog(storage.path());
    let lease = upload(&c, "a.json", b"[]");
    let i = Ingestor::new(config(path), ServiceLimits::default()).unwrap();
    assert_eq!(
        i.ingest(&lease, "w", 1).unwrap_err().code,
        ErrorCode::InvalidInput
    );
}
