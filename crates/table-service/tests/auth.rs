// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use std::collections::BTreeMap;
use table_service::{AuthConfig, Authenticator, ErrorCode, Principal, RequestCredentials};
const DESKTOP: &str = "desktop-token-at-least-thirty-two-bytes";
const GATEWAY: &str = "gateway-token-at-least-thirty-two-bytes";
fn auth() -> Authenticator {
    Authenticator::new(AuthConfig {
        desktop_tokens: BTreeMap::from([(DESKTOP.into(), Principal("desktop-owner".into()))]),
        gateway_token: Some(GATEWAY.into()),
    })
    .unwrap()
}
#[test]
fn authenticated_tokens_derive_principals_and_forged_headers_are_rejected() {
    let auth = auth();
    assert_eq!(
        auth.authenticate(RequestCredentials {
            bearer_token: Some(DESKTOP),
            ..Default::default()
        })
        .unwrap(),
        Principal("desktop-owner".into())
    );
    assert_eq!(
        auth.authenticate(RequestCredentials {
            gateway_token: Some(GATEWAY),
            forwarded_principal: Some("web-owner"),
            ..Default::default()
        })
        .unwrap(),
        Principal("web-owner".into())
    );
    for credentials in [
        RequestCredentials::default(),
        RequestCredentials {
            forwarded_principal: Some("victim"),
            ..Default::default()
        },
        RequestCredentials {
            bearer_token: Some(DESKTOP),
            forwarded_principal: Some("victim"),
            ..Default::default()
        },
        RequestCredentials {
            gateway_token: Some("wrong"),
            forwarded_principal: Some("victim"),
            ..Default::default()
        },
        RequestCredentials {
            gateway_token: Some(GATEWAY),
            ..Default::default()
        },
        RequestCredentials {
            bearer_token: Some(DESKTOP),
            gateway_token: Some(GATEWAY),
            forwarded_principal: Some("victim"),
        },
    ] {
        assert_eq!(
            auth.authenticate(credentials).unwrap_err().code,
            ErrorCode::Unauthorized
        );
    }
}
#[test]
fn invalid_or_shared_credentials_cannot_configure_an_authenticator() {
    assert!(Authenticator::new(AuthConfig::default()).is_err());
    assert!(Authenticator::new(AuthConfig {
        desktop_tokens: BTreeMap::from([("weak".into(), Principal("owner".into()))]),
        gateway_token: None
    })
    .is_err());
    assert!(Authenticator::new(AuthConfig {
        desktop_tokens: BTreeMap::from([(DESKTOP.into(), Principal("owner".into()))]),
        gateway_token: Some(DESKTOP.into())
    })
    .is_err());
    assert!(Authenticator::new(AuthConfig {
        desktop_tokens: BTreeMap::from([(DESKTOP.into(), Principal("".into()))]),
        gateway_token: None
    })
    .is_err());
}
