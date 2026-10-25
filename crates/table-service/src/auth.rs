// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use crate::{ErrorCode, ServiceError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use subtle::ConstantTimeEq;

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Principal(pub String);
impl Principal {
    pub fn validate(&self) -> Result<(), ServiceError> {
        if self.0.is_empty()
            || self.0.len() > 512
            || self.0.trim() != self.0
            || self.0.chars().any(char::is_control)
        {
            return Err(ServiceError::new(
                ErrorCode::InvalidInput,
                "invalid principal",
            ));
        }
        Ok(())
    }
}

/// Secret configuration deliberately does not implement Debug or Serialize.
#[derive(Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AuthConfig {
    pub desktop_tokens: BTreeMap<String, Principal>,
    pub gateway_token: Option<String>,
}

/// Header extraction is the HTTP adapter's responsibility. Values are raw tokens,
/// without a `Bearer ` prefix. Reject duplicate authentication headers at that boundary.
#[derive(Clone, Copy, Default)]
pub struct RequestCredentials<'a> {
    pub bearer_token: Option<&'a str>,
    pub gateway_token: Option<&'a str>,
    pub forwarded_principal: Option<&'a str>,
}

pub struct Authenticator {
    desktop: Vec<([u8; 32], Principal)>,
    gateway: Option<[u8; 32]>,
}
impl Authenticator {
    pub fn new(config: AuthConfig) -> Result<Self, ServiceError> {
        let invalid = || {
            ServiceError::new(
                ErrorCode::InvalidConfig,
                "authentication requires distinct nonempty strong credentials and valid principals",
            )
        };
        if config.desktop_tokens.is_empty() && config.gateway_token.is_none() {
            return Err(invalid());
        }
        let mut desktop = Vec::new();
        for (token, principal) in config.desktop_tokens {
            if !valid_token(&token)
                || principal.validate().is_err()
                || config.gateway_token.as_ref() == Some(&token)
            {
                return Err(invalid());
            }
            desktop.push((token_digest(&token), principal));
        }
        let gateway = match config.gateway_token {
            Some(token) if valid_token(&token) => Some(token_digest(&token)),
            Some(_) => return Err(invalid()),
            None => None,
        };
        Ok(Self { desktop, gateway })
    }
    pub fn authenticate(&self, request: RequestCredentials<'_>) -> Result<Principal, ServiceError> {
        let unauthorized = || ServiceError::new(ErrorCode::Unauthorized, "authentication required");
        if let Some(token) = request.bearer_token {
            if request.gateway_token.is_some()
                || request.forwarded_principal.is_some()
                || token.len() > 4096
            {
                return Err(unauthorized());
            }
            let hash = token_digest(token);
            let mut found = None;
            // Compare fixed-width cryptographic hashes, visiting every configured token.
            for (expected, principal) in &self.desktop {
                if bool::from(hash.ct_eq(expected)) {
                    found = Some(principal.clone());
                }
            }
            return found.ok_or_else(unauthorized);
        }
        let (Some(token), Some(principal), Some(expected)) = (
            request.gateway_token,
            request.forwarded_principal,
            self.gateway,
        ) else {
            return Err(unauthorized());
        };
        if token.len() > 4096
            || principal.len() > 512
            || !bool::from(token_digest(token).ct_eq(&expected))
        {
            return Err(unauthorized());
        }
        let principal = Principal(principal.to_string());
        principal.validate().map_err(|_| unauthorized())?;
        Ok(principal)
    }
}
fn valid_token(token: &str) -> bool {
    token.len() >= 32 && token.len() <= 4096 && token.bytes().all(|b| b.is_ascii_graphic())
}
fn token_digest(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}
