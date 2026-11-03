// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use crate::{ErrorCode, ServiceError};
use pivot_core::contract::ValueRecord;
use serde_json::Value;
/// A small source identity proof, never the retained rows or trusted acquisition configuration.
pub(crate) fn source_receipt(
    receipt: Option<&ValueRecord>,
    max_bytes: usize,
) -> Result<Option<Value>, ServiceError> {
    let Some(proof) = receipt.and_then(|r| r.get("temporal")) else {
        return Ok(None);
    };
    let bytes = serde_json::to_vec(proof).map_err(|_| {
        ServiceError::new(ErrorCode::InvalidInput, "invalid temporal source receipt")
    })?;
    if bytes.len() > max_bytes {
        return Err(ServiceError::new(
            ErrorCode::LimitExceeded,
            "temporal source receipt exceeds metadata limit",
        ));
    }
    Ok(Some(serde_json::from_slice(&bytes).map_err(|_| {
        ServiceError::new(ErrorCode::InvalidInput, "invalid temporal source receipt")
    })?))
}
#[cfg(test)]
mod tests {
    use super::*;
    use pivot_core::contract::WireValue;
    #[test]
    fn temporal_receipt_is_exact_and_bounded_without_rows_or_credentials() {
        let proof = WireValue::Record(vec![(
            "executionId".into(),
            WireValue::String("retained".into()),
        )]);
        let receipt = [("temporal".into(), proof.clone())].into();
        assert_eq!(
            source_receipt(Some(&receipt), 4096).unwrap(),
            Some(serde_json::to_value(proof).unwrap())
        );
        assert!(source_receipt(Some(&receipt), 2).is_err());
        assert_eq!(source_receipt(None, 4096).unwrap(), None);
    }
}
