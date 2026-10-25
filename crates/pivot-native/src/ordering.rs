// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use pivot_core::{
    contract::*,
    ordering::{missing, number, string_value, Comparison, ValueOrder},
};
use std::{
    cmp::Ordering,
    ffi::{c_char, c_void, CString},
    ptr::NonNull,
};
unsafe extern "C" {
    fn pivot_icu_open(tag: *const c_char, pivot: i32) -> *mut c_void;
    fn pivot_icu_close(collator: *mut c_void);
    fn pivot_icu_compare(
        collator: *const c_void,
        a: *const c_char,
        alen: i32,
        b: *const c_char,
        blen: i32,
        error: *mut i32,
    ) -> i32;
}
fn diagnostic(message: &str) -> Diagnostic {
    pivot_core::validation::diagnostic("ordering-compatibility-unavailable", "locale", message)
}
struct Collator(NonNull<c_void>);
// SAFETY: UCollator has no thread affinity. Ownership can move between threads;
// this wrapper permits neither mutation nor concurrent sharing (no Sync impl).
// The allocation remains uniquely owned and is closed by its eventual owner.
unsafe impl Send for Collator {}
impl Collator {
    fn new(locale: &CString, pivot: bool) -> Result<Self, Diagnostic> {
        // SAFETY: CString lives through the call; the shim returns a uniquely owned
        // ICU collator or null. No pointer escapes except into this RAII owner.
        NonNull::new(unsafe { pivot_icu_open(locale.as_ptr(), i32::from(pivot)) })
            .map(Self)
            .ok_or_else(|| {
                diagnostic(
                    "Unsupported Pivot locale or incompatible ICU runtime (requires ICU4C 78.3).",
                )
            })
    }
    fn compare(&self, a: &str, b: &str) -> Result<Ordering, Diagnostic> {
        let alen = i32::try_from(a.len())
            .map_err(|_| diagnostic("Collation input exceeds ICU string length."))?;
        let blen = i32::try_from(b.len())
            .map_err(|_| diagnostic("Collation input exceeds ICU string length."))?;
        let mut error = 0;
        // SAFETY: UTF-8 strings and lengths remain valid for the synchronous call;
        // ICU only reads these buffers and writes the local status. The collator is
        // alive, immutable during comparison, and never shared across threads.
        let result = unsafe {
            pivot_icu_compare(
                self.0.as_ptr(),
                a.as_ptr().cast(),
                alen,
                b.as_ptr().cast(),
                blen,
                &mut error,
            )
        };
        if error != 0 {
            Err(diagnostic("ICU text comparison failed."))
        } else {
            Ok(result.cmp(&0))
        }
    }
}
impl Drop for Collator {
    fn drop(&mut self) {
        // SAFETY: this owner closes its one successful allocation exactly once.
        unsafe { pivot_icu_close(self.0.as_ptr()) }
    }
}
/// Collators remain session-owned; no global locale, JS process or callback.
pub struct NativeOrder {
    pivot: Collator,
    recipe: Collator,
}
impl NativeOrder {
    pub fn new(locale: &str) -> Result<Self, Diagnostic> {
        if locale.is_empty() {
            return Err(diagnostic("Pivot locale must be explicit."));
        }
        let locale = CString::new(locale).map_err(|_| diagnostic("Invalid Pivot locale."))?;
        Ok(Self {
            pivot: Collator::new(&locale, true)?,
            recipe: Collator::new(&locale, false)?,
        })
    }
}
impl ValueOrder for NativeOrder {
    fn compare_recipe(&self, a: &str, b: &str) -> Result<Ordering, Diagnostic> {
        self.recipe.compare(a, b)
    }
    fn compare(&self, a: &WireValue, b: &WireValue) -> Result<Ordering, Diagnostic> {
        Ok(self.compare_raw(a, b)?.sort_order())
    }
    fn compare_raw(&self, a: &WireValue, b: &WireValue) -> Result<Comparison, Diagnostic> {
        let (am, bm) = (missing(a), missing(b));
        if am || bm {
            return Ok(Comparison::Ordered(am.cmp(&bm)));
        }
        if let (Some(a), Some(b)) = (number(a), number(b)) {
            return Ok((a - b)
                .partial_cmp(&0.)
                .map(Comparison::Ordered)
                .unwrap_or(Comparison::Unordered));
        }
        Ok(Comparison::Ordered(
            self.pivot.compare(&string_value(a)?, &string_value(b)?)?,
        ))
    }
    fn sort_permutation(
        &self,
        values: &[Vec<WireValue>],
        descending: &[bool],
    ) -> Result<Vec<usize>, Diagnostic> {
        if values.iter().any(|row| row.len() != descending.len()) {
            return Err(pivot_core::validation::diagnostic(
                "invalid-order-keys",
                "table.sorting",
                "Sort keys must match the sort dimensions.",
            ));
        }
        let mut indexes: Vec<_> = (0..values.len()).collect();
        crate::timsort::sort(&mut indexes, |a, b| {
            for (key, desc) in descending.iter().enumerate() {
                let c = pivot_core::ordering::compare_sorted_raw(
                    &values[a][key],
                    &values[b][key],
                    *desc,
                    self,
                )?;
                if !c.is_zero() {
                    return Ok(c.sort_order());
                }
            }
            Ok(Ordering::Equal)
        })?;
        Ok(indexes)
    }
}
