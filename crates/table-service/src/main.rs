// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use table_service::{http::router, server_config::ServerConfig};
#[tokio::main]
async fn main() {
    if let Err(error) = serve().await {
        eprintln!("table-service: {error}");
        std::process::exit(1);
    }
}
async fn serve() -> Result<(), Box<dyn std::error::Error>> {
    let path =
        std::env::var_os("TABLE_SERVICE_CONFIG").ok_or("TABLE_SERVICE_CONFIG is required")?;
    let (listen, state) = ServerConfig::load(std::path::Path::new(&path))?.build()?;
    let manager = state.manager.clone();
    let listener = tokio::net::TcpListener::bind(listen)
        .await
        .map_err(|_| "service listener unavailable")?;
    let cleanup = tokio::spawn({
        let manager = manager.clone();
        async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                interval.tick().await;
                let m = manager.clone();
                if tokio::task::spawn_blocking(move || m.cleanup())
                    .await
                    .is_err()
                {
                    break;
                }
            }
        }
    });
    let result = axum::serve(listener, router(state))
        .with_graceful_shutdown({
            let manager = manager.clone();
            async move {
                let mut term =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("signal support");
                tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}}
                let _ = tokio::task::spawn_blocking(move || manager.shutdown()).await;
            }
        })
        .await;
    cleanup.abort();
    tokio::task::spawn_blocking(move || manager.shutdown()).await?;
    result.map_err(|_| "HTTP server failed".into())
}
