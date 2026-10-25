// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! JavaScript relational semantics for number-filter bounds. Formula arithmetic never coerces.
use crate::{
    contract::WireValue,
    ordering::{number, value_string},
};
use std::cmp::Ordering;
const PRIMITIVE_FAILURE: &str = "Cannot convert object to primitive value";

/// Partial comparison preserves NaN's unordered result; BigInt is never rounded to f64.
pub(super) fn compare_bound(
    cell: f64,
    bound: &WireValue,
) -> Result<Option<Ordering>, &'static str> {
    if let WireValue::BigIntString(integer) = bound {
        return Ok(compare_bigint(cell, integer));
    }
    let bound = match bound {
        WireValue::Missing => f64::NAN,
        WireValue::Null => 0.,
        WireValue::Bool(v) => f64::from(*v),
        WireValue::String(s) => string_number(s),
        WireValue::Array(_) => string_number(&array_string(bound)?),
        WireValue::Record(entries) => {
            if entries.iter().any(|(key, _)| key == "toString") {
                return Err(PRIMITIVE_FAILURE);
            }
            f64::NAN
        }
        WireValue::F64(_) => number(bound).unwrap(),
        WireValue::BigIntString(_) => unreachable!(),
    };
    Ok(cell.partial_cmp(&bound))
}

fn string_number(s: &str) -> f64 {
    let s = s.trim_matches(crate::formulas::ecmascript_whitespace);
    if s.is_empty() {
        return 0.;
    }
    match s {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    if s.len() >= 2 && s.as_bytes()[0] == b'0' {
        let radix = match s.as_bytes()[1] {
            b'x' | b'X' => Some((16, 4)),
            b'o' | b'O' => Some((8, 3)),
            b'b' | b'B' => Some((2, 1)),
            _ => None,
        };
        if let Some((radix, bits)) = radix {
            return radix_number(&s[2..], radix, bits);
        }
    }
    let bytes = s.as_bytes();
    let mut i = usize::from(matches!(bytes.first(), Some(b'+' | b'-')));
    let mut digits = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
        digits += 1
    }
    if i < bytes.len() && bytes[i] == b'.' {
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
            digits += 1
        }
    }
    if digits == 0 {
        return f64::NAN;
    }
    if i < bytes.len() && matches!(bytes[i], b'e' | b'E') {
        i += 1;
        if i < bytes.len() && matches!(bytes[i], b'+' | b'-') {
            i += 1
        }
        let start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1
        }
        if i == start {
            return f64::NAN;
        }
    }
    if i != bytes.len() {
        return f64::NAN;
    }
    s.parse().unwrap_or(f64::NAN)
}

/// Power-of-two radix conversion with one nearest-even rounding at the binary64 boundary.
fn radix_number(digits: &str, radix: u32, bits_per_digit: usize) -> f64 {
    if digits.is_empty() {
        return f64::NAN;
    }
    let digit = |b: u8| match b {
        b'0'..=b'9' => Some(u32::from(b - b'0')),
        b'a'..=b'f' => Some(u32::from(b - b'a') + 10),
        b'A'..=b'F' => Some(u32::from(b - b'A') + 10),
        _ => None,
    };
    if digits.bytes().any(|b| digit(b).is_none_or(|d| d >= radix)) {
        return f64::NAN;
    }
    let digits = digits.trim_start_matches('0');
    if digits.is_empty() {
        return 0.;
    }
    let first = digit(digits.as_bytes()[0]).unwrap();
    let first_bits = (32 - first.leading_zeros()) as usize;
    let bits = first_bits + (digits.len() - 1) * bits_per_digit;
    if bits > 1024 {
        return f64::INFINITY;
    }
    let mut mantissa = 0u64;
    let mut seen = 0;
    let mut guard = false;
    let mut sticky = false;
    for (i, b) in digits.bytes().enumerate() {
        let value = digit(b).unwrap();
        let width = if i == 0 { first_bits } else { bits_per_digit };
        for bit in (0..width).rev() {
            let one = value & (1 << bit) != 0;
            if seen < 53 {
                mantissa = (mantissa << 1) | u64::from(one)
            } else if seen == 53 {
                guard = one
            } else {
                sticky |= one
            }
            seen += 1
        }
    }
    if bits <= 53 {
        return mantissa as f64;
    }
    if guard && (sticky || mantissa & 1 != 0) {
        mantissa += 1
    }
    (mantissa as f64) * 2f64.powi((bits - 53) as i32)
}

/// Array join uses ToString for elements, including nested arrays and observable object failures.
fn array_string(value: &WireValue) -> Result<String, &'static str> {
    enum Part<'a> {
        Value(&'a WireValue),
        Comma,
    }
    let mut parts = vec![Part::Value(value)];
    let mut out = String::new();
    while let Some(part) = parts.pop() {
        match part {
            Part::Comma => out.push(','),
            Part::Value(value) => match value {
                WireValue::Missing | WireValue::Null => {}
                WireValue::Array(values) => {
                    for (i, value) in values.iter().enumerate().rev() {
                        parts.push(Part::Value(value));
                        if i > 0 {
                            parts.push(Part::Comma)
                        }
                    }
                }
                WireValue::Record(entries) => {
                    if entries.iter().any(|(key, _)| key == "toString") {
                        return Err(PRIMITIVE_FAILURE);
                    }
                    out.push_str("[object Object]")
                }
                _ => out.push_str(&value_string(value)),
            },
        }
    }
    Ok(out)
}

/// Compare mathematical Number and BigInt values by sign and the exact binary64 integer part.
fn compare_bigint(number: f64, integer: &str) -> Option<Ordering> {
    if number.is_nan() {
        return None;
    }
    if number == f64::INFINITY {
        return Some(Ordering::Greater);
    }
    if number == f64::NEG_INFINITY {
        return Some(Ordering::Less);
    }
    let negative = number < 0.;
    let integer_negative = integer.starts_with('-');
    if negative != integer_negative {
        return Some(if negative {
            Ordering::Less
        } else {
            Ordering::Greater
        });
    }
    let integer = integer.strip_prefix('-').unwrap_or(integer);
    let absolute = number.abs();
    let whole = integer_part_decimal(absolute);
    let mut comparison = whole
        .len()
        .cmp(&integer.len())
        .then_with(|| whole.as_str().cmp(integer));
    if comparison == Ordering::Equal && absolute.fract() != 0. {
        comparison = Ordering::Greater
    }
    Some(if negative {
        comparison.reverse()
    } else {
        comparison
    })
}
fn integer_part_decimal(number: f64) -> String {
    let bits = number.to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    let significand = bits & ((1u64 << 52) - 1);
    let (significand, shift) = if exponent == 0 {
        (significand, -1074)
    } else {
        (significand | (1u64 << 52), exponent - 1075)
    };
    if shift < 0 {
        return (if shift <= -64 {
            0
        } else {
            significand >> (-shift)
        })
        .to_string();
    }
    let mut digits = significand
        .to_string()
        .bytes()
        .rev()
        .map(|b| b - b'0')
        .collect::<Vec<_>>();
    for _ in 0..shift {
        let mut carry = 0;
        for digit in &mut digits {
            let value = *digit * 2 + carry;
            *digit = value % 10;
            carry = value / 10
        }
        if carry != 0 {
            digits.push(carry)
        }
    }
    digits
        .into_iter()
        .rev()
        .map(|d| char::from(b'0' + d))
        .collect()
}
