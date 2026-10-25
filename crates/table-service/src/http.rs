// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Authenticated HTTP adapter. JSON wire is opaque text to preserve structural -0.
use crate::{sessions::*, *};
use axum::{
    body::{to_bytes, Bytes},
    extract::{Request, State},
    http::{HeaderMap, Method},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{io::Cursor, sync::Arc, time::Duration};
use tokio::sync::Semaphore;
#[derive(Clone)]
pub struct HttpState {
    auth: Arc<Authenticator>,
    pub manager: Arc<SessionManager>,
    catalog_config: CatalogConfig,
    requests: Arc<Semaphore>,
    controls: Arc<Semaphore>,
}
impl HttpState {
    pub fn new(
        auth: Arc<Authenticator>,
        manager: Arc<SessionManager>,
        catalog_config: CatalogConfig,
    ) -> Self {
        Self {
            auth,
            requests: Arc::new(Semaphore::new(manager.runtime.max_http_requests)),
            controls: Arc::new(Semaphore::new(CONTROL_HTTP_REQUESTS)),
            manager,
            catalog_config,
        }
    }
}
pub fn router(state: HttpState) -> Router {
    Router::new()
        .fallback(handle)
        .layer(middleware::from_fn_with_state(state.clone(), authenticate))
        .with_state(state)
}
async fn authenticate(State(state): State<HttpState>, mut req: Request, next: Next) -> Response {
    let result = (|| {
        let bearer = one(req.headers(), "authorization")?;
        let bearer = match bearer {
            Some(v) => Some(v.strip_prefix("Bearer ").ok_or_else(unauthorized)?),
            None => None,
        };
        state.auth.authenticate(RequestCredentials {
            bearer_token: bearer,
            gateway_token: one(req.headers(), "x-table-gateway-token")?,
            forwarded_principal: one(req.headers(), "x-table-principal")?,
        })
    })();
    let owner = match result {
        Ok(p) => p,
        Err(e) => return e.into_response(),
    };
    let admission = if control_route(&req) {
        &state.controls
    } else {
        &state.requests
    };
    let _permit = match admission.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => return limit("HTTP admission is full").into_response(),
    };
    req.extensions_mut().insert(owner);
    next.run(req).await
}
// Match only complete managed control paths. Malformed paths, other methods,
// queries and source deletion retain ordinary admission, even on the fallback.
fn control_route(req: &Request) -> bool {
    if req.uri().query().is_some() {
        return false;
    }
    let parts: Vec<_> = req.uri().path().split('/').collect();
    let id = match (req.method(), parts.as_slice()) {
        (&Method::POST, ["", "sessions", id, "cancel"]) => id,
        (&Method::DELETE, ["", "sessions" | "exports", id]) => id,
        _ => return false,
    };
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
fn unauthorized() -> ServiceError {
    ServiceError::new(ErrorCode::Unauthorized, "authentication required")
}
fn one<'a>(headers: &'a HeaderMap, key: &str) -> Result<Option<&'a str>, ServiceError> {
    let mut values = headers.get_all(key).iter();
    let first = values.next();
    if values.next().is_some() {
        return Err(unauthorized());
    }
    first
        .map(|v| v.to_str().map_err(|_| unauthorized()))
        .transpose()
}
async fn handle(State(state): State<HttpState>, req: Request) -> Response {
    match route(state, req).await {
        Ok(value) => Json(value).into_response(),
        Err(e) => e.into_response(),
    }
}
async fn body(req: Request, max: usize, seconds: u64) -> Result<Bytes, ServiceError> {
    tokio::time::timeout(Duration::from_secs(seconds), to_bytes(req.into_body(), max))
        .await
        .map_err(|_| limit("request body deadline exceeded"))?
        .map_err(|_| limit("request body exceeds byte limit"))
}
fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, ServiceError> {
    serde_json::from_slice(bytes).map_err(|_| invalid("invalid JSON request"))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackendRequest {
    idempotency_key: String,
    binding: BackendBinding,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelRequest {
    target_request_id: Option<String>,
}
async fn route(state: HttpState, req: Request) -> Result<Value, ServiceError> {
    let owner = req
        .extensions()
        .get::<Principal>()
        .cloned()
        .ok_or_else(unauthorized)?;
    let method = req.method().clone();
    let path = req.uri().path().to_owned();
    let parts: Vec<_> = path.trim_matches('/').split('/').collect();
    let query = req.uri().query().unwrap_or("").to_owned();
    let m = state.manager.clone();
    if method == Method::GET {
        match parts.as_slice() {
            ["healthz"] => return Ok(json!({"status":"ok"})),
            ["capabilities"] => return Ok(capabilities()),
            ["widgets.json"] => {
                return Ok(
                    json!({"managed_table":{"name":"Managed native table","type":"table_ssrm","endpoint":"/sessions","provider":"managed-native","protocolVersion":1}}),
                )
            }
            ["sources", "backends"] => {
                return Ok(
                    json!({"backends":state.catalog_config.backend_widgets.iter().map(|(backend,widgets)|json!({"backendId":backend,"label":backend,"widgets":widgets.iter().map(|(id,params)|json!({"widgetId":id,"label":id,"parameters":params})).collect::<Vec<_>>()})).collect::<Vec<_>>()}),
                )
            }
            ["exports", id, "batches"] => {
                let sequence = query
                    .strip_prefix("sequence=")
                    .filter(|s| !s.contains('&'))
                    .and_then(|s| s.parse::<u64>().ok())
                    .filter(|n| *n <= MAX_SAFE)
                    .ok_or_else(|| invalid("expected sequence query"))?;
                let id = id.to_string();
                let p = owner.clone();
                return m
                    .run(owner, move |m, c| {
                        serde_json::to_value(m.export_batch(&p, &id, sequence, &c)?)
                            .map_err(|_| invalid("encoding failed"))
                    })
                    .await;
            }
            _ => {}
        }
    }
    if method == Method::DELETE {
        let key = parts.get(1).map(|s| s.to_string()).unwrap_or_default();
        let kind = parts.first().copied().unwrap_or("");
        if parts.len() == 2 {
            let p = owner.clone();
            match kind {
                "sources" => {
                    return m
                        .run(owner, move |m, _| {
                            m.catalog.delete(&p, &key)?;
                            Ok(json!({"deleted":true}))
                        })
                        .await
                }
                "sessions" => {
                    m.fence_control(&p, &key, None, true)?
                        .finish_async()
                        .await?;
                    return Ok(json!({"disposed":true}));
                }
                "exports" => {
                    // A control route like session dispose: no compute admission,
                    // so a busy principal can always release an export.
                    tokio::task::spawn_blocking(move || m.delete_export(&p, &key))
                        .await
                        .map_err(|_| invalid("control cleanup failed"))??;
                    return Ok(json!({"deleted":true}));
                }
                _ => {}
            }
        }
    }
    if method == Method::POST {
        if parts.as_slice() == ["sources", "uploads"] {
            let key = one(req.headers(), "idempotency-key")?
                .ok_or_else(|| invalid("idempotency-key is required"))?
                .to_owned();
            let name = decode_upload_filename(
                one(req.headers(), "x-upload-filename")?
                    .ok_or_else(|| invalid("x-upload-filename is required"))?,
            )?;
            let media = one(req.headers(), "content-type")?
                .unwrap_or("application/octet-stream")
                .to_owned();
            let bytes = body(
                req,
                m.limits.max_upload_bytes as usize,
                m.runtime.body_seconds,
            )
            .await?;
            let p = owner.clone();
            return m
                .run(owner, move |m, cancel| {
                    check(&cancel)?;
                    serde_json::to_value(m.catalog.create_upload(
                        &p,
                        &key,
                        UploadMetadata {
                            filename: name,
                            media_type: media,
                        },
                        Cursor::new(bytes),
                    )?)
                    .map_err(|_| invalid("encoding failed"))
                })
                .await;
        }
        let bytes = body(req, m.runtime.max_command_bytes, m.runtime.body_seconds).await?;
        let p = owner.clone();
        match parts.as_slice() {
            ["sources", "backends"] => {
                return m
                    .run(owner, move |m, _| {
                        let r: BackendRequest = decode(&bytes)?;
                        Ok(serde_json::to_value(m.catalog.register_backend(
                            &p,
                            &r.idempotency_key,
                            r.binding,
                        )?)
                        .unwrap())
                    })
                    .await
            }
            ["sessions"] => {
                return m
                    .run(owner, move |m, c| m.open(&p, decode(&bytes)?, &c))
                    .await
            }
            ["sessions", id, "derive"] => {
                return m.derive_session(owner, id, decode(&bytes)?).await;
            }
            ["sessions", id, "commands"] => {
                let r = m
                    .execute_command(owner, id.to_string(), decode(&bytes)?)
                    .await?;
                if serde_json::to_vec(&r).unwrap().len() > m.limits.max_export_batch_bytes {
                    return Err(limit("response exceeds byte limit"));
                }
                return Ok(serde_json::to_value(r).unwrap());
            }
            ["sessions", id, "cancel"] => {
                let r: CancelRequest = decode(&bytes)?;
                m.fence_control(&owner, id, r.target_request_id.as_deref(), false)?
                    .finish_async()
                    .await?;
                return Ok(json!({"cancelled":true}));
            }
            ["sessions", id, "exports"] => {
                let id = id.to_string();
                return m
                    .run_session(owner, &id, decode(&bytes)?, move |m, c, command| {
                        if command.refresh.is_some() {
                            return Err(invalid("invalid export identity"));
                        }
                        check(&c)?;
                        let (id, reply) = m.start_export(&p, command, &c)?;
                        Ok(json!({"exportId":id,"batch":reply}))
                    })
                    .await;
            }
            _ => {}
        }
    }
    Err(ServiceError::new(
        ErrorCode::NotFound,
        "route or method not available",
    ))
}

/// X-Upload-Filename is encodeURIComponent UTF-8, not form encoding. Decode only
/// at this HTTP boundary; the catalog validates and stores the decoded basename.
fn decode_upload_filename(encoded: &str) -> Result<String, ServiceError> {
    let mut bytes = encoded.bytes();
    let mut decoded = Vec::with_capacity(encoded.len());
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let high = bytes.next().and_then(|b| (b as char).to_digit(16));
            let low = bytes.next().and_then(|b| (b as char).to_digit(16));
            let (Some(high), Some(low)) = (high, low) else {
                return Err(invalid("invalid upload filename encoding"));
            };
            decoded.push((high * 16 + low) as u8);
        } else {
            decoded.push(byte);
        }
    }
    String::from_utf8(decoded).map_err(|_| invalid("invalid upload filename UTF-8"))
}
