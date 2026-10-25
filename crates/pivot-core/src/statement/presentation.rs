// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::StatementIntent;
use crate::contract::*;
use std::collections::BTreeSet;
const MAX_BYTES: usize = 1024 * 1024;
fn invalid() -> Diagnostic {
    crate::analytical::diagnostic(
        "INVALID_REQUEST",
        "Invalid or unsupported Statement presentation metadata",
    )
}
/// UTF-16 length bound matches the TypeScript `text` guard.
fn text(s: &str) -> Result<WireValue, Diagnostic> {
    let n = s.encode_utf16().count();
    if n == 0 || n > 4096 {
        return Err(invalid());
    }
    Ok(WireValue::String(s.into()))
}
/// Records keep the TypeScript key order on the wire.
fn record(fields: Vec<(&str, WireValue)>) -> WireValue {
    WireValue::Record(fields.into_iter().map(|(k, v)| (k.into(), v)).collect())
}
/// UTF-8 length of `JSON.stringify` for the string/array/record/1 values built here.
fn json_len(v: &WireValue) -> usize {
    let quoted = |s: &str| serde_json::to_string(s).unwrap().len();
    let joined =
        |items: Vec<usize>| 2 + items.len().saturating_sub(1) + items.iter().sum::<usize>();
    match v {
        WireValue::String(s) => quoted(s),
        WireValue::Array(a) => joined(a.iter().map(json_len).collect()),
        WireValue::Record(r) => {
            joined(r.iter().map(|(k, v)| quoted(k) + 1 + json_len(v)).collect())
        }
        _ => 1,
    }
}
fn ordered<'a>(order: Option<&'a Vec<String>>, all: &'a [String]) -> Vec<&'a String> {
    let order = order.map_or(all, Vec::as_slice);
    order
        .iter()
        .chain(all.iter().filter(|id| !order.contains(id)))
        .collect()
}
/// Presentation evidence only, mirroring `statementPresentation` and its
/// `readStatementPresentation` validation in src/lib/statementPresentation.ts.
#[allow(clippy::result_large_err)]
pub fn statement_presentation(
    i: &StatementIntent,
    layout: &Layout,
) -> Result<WireValue, Diagnostic> {
    let o = &i.overrides;
    let template_ids: Vec<String> = i.template.sections.iter().map(|s| s.id.clone()).collect();
    let section_ids = ordered(o.section_order.as_ref(), &template_ids);
    if section_ids.len() > 256 {
        return Err(invalid());
    }
    let label = |id: &String, fallback: &String| text(o.labels.get(id).unwrap_or(fallback));
    let (mut seen, mut count, mut sections) = (BTreeSet::new(), 0, vec![]);
    for id in section_ids {
        let section = i
            .template
            .sections
            .iter()
            .find(|s| &s.id == id)
            .ok_or_else(invalid)?;
        if !seen.insert(id) {
            return Err(invalid());
        }
        let mut lines = vec![];
        for line_id in ordered(o.line_order.get(id), &section.line_ids) {
            let line = i
                .template
                .lines
                .iter()
                .find(|l| &l.id == line_id)
                .ok_or_else(invalid)?;
            count += 1;
            if count > 4096 || !seen.insert(line_id) {
                return Err(invalid());
            }
            lines.push(record(vec![
                ("id", text(line_id)?),
                ("label", label(line_id, &line.label)?),
            ]));
        }
        sections.push(record(vec![
            ("id", text(id)?),
            ("label", label(id, &section.label)?),
            ("lines", WireValue::Array(lines)),
        ]));
    }
    let nth = |v: &Vec<String>, n: usize| v.get(n).ok_or_else(invalid).and_then(|s| text(s));
    let value = record(vec![
        ("schemaVersion", WireValue::F64(WireNumber::Finite(1.))),
        ("sectionCategoryId", nth(&layout.rows, 0)?),
        ("itemCategoryId", nth(&layout.rows, 1)?),
        ("periodCategoryId", nth(&layout.columns, 0)?),
        ("valueMeasureId", nth(&layout.values, 0)?),
        ("sections", WireValue::Array(sections)),
    ]);
    if json_len(&value) > MAX_BYTES {
        return Err(invalid());
    }
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn json_len_matches_json_stringify_bytes() {
        let s = |v: &str| WireValue::String(v.into());
        let v = record(vec![
            ("schemaVersion", WireValue::F64(WireNumber::Finite(1.))),
            ("a", s("q\"é\n")),
            (
                "b",
                WireValue::Array(vec![s("x"), record(vec![]), WireValue::Array(vec![])]),
            ),
        ]);
        assert_eq!(
            json_len(&v),
            r#"{"schemaVersion":1,"a":"q\"é\n","b":["x",{},[]]}"#.len()
        );
    }
}
