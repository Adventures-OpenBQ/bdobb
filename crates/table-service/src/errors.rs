// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use crate::{ErrorCode, ServiceError};
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
impl IntoResponse for ServiceError {
    fn into_response(self) -> Response {
        let status = match self.code {
            ErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
            ErrorCode::NotFound => StatusCode::NOT_FOUND,
            ErrorCode::Gone => StatusCode::GONE,
            ErrorCode::InvalidInput => StatusCode::BAD_REQUEST,
            ErrorCode::Conflict => StatusCode::CONFLICT,
            ErrorCode::LimitExceeded => StatusCode::PAYLOAD_TOO_LARGE,
            ErrorCode::InvalidConfig | ErrorCode::Io | ErrorCode::CorruptStorage => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (status, Json(serde_json::json!({"error":self}))).into_response()
    }
}
