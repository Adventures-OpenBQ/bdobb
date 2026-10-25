// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Retain full structured cell-error evidence at the native stage boundary.
#![allow(clippy::result_large_err)]
//! Explicit acquired fiscal evidence. Missing context is never a December calendar.
use crate::{
    contract::*,
    formulas::ModelError,
    ordering::{number, value_string},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
/// Ordered company metadata with logarithmic lookup and stable locale-comparison ties.
#[derive(Clone, Debug, Default)]
pub struct FiscalCompanies {
    entries: Vec<(String, FiscalCompanyContext)>,
    index: BTreeMap<String, usize>,
}
impl FiscalCompanies {
    pub fn get(&self, k: &str) -> Option<&FiscalCompanyContext> {
        self.index.get(k).map(|i| &self.entries[*i].1)
    }
    pub fn iter(&self) -> impl Iterator<Item = (&String, &FiscalCompanyContext)> {
        self.entries.iter().map(|(k, v)| (k, v))
    }
}
impl FromIterator<(String, FiscalCompanyContext)> for FiscalCompanies {
    fn from_iter<I: IntoIterator<Item = (String, FiscalCompanyContext)>>(values: I) -> Self {
        let mut entries: Vec<_> = values.into_iter().collect();
        entries.sort_by_key(|e| crate::contract::js_key_order(&e.0));
        let index = entries
            .iter()
            .enumerate()
            .map(|(i, (k, _))| (k.clone(), i))
            .collect();
        Self { entries, index }
    }
}
impl Serialize for FiscalCompanies {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_map(self.iter())
    }
}
impl<'de> Deserialize<'de> for FiscalCompanies {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let entries = crate::contract::ordered_entries(
            d,
            "company metadata map",
            "Duplicate fiscal company key",
            None,
        )?;
        Ok(entries.into_iter().collect())
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FiscalContext {
    pub companies: Option<FiscalCompanies>,
    pub metadata: Option<BTreeMap<String, FiscalCompanies>>,
    pub overrides: Option<FiscalCompanies>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiscalCompanyContext {
    pub year_end_month: Option<i64>,
    pub calendar: Option<String>,
    pub source: String,
    #[serde(default)]
    pub periods: Vec<FiscalPeriod>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct FiscalPeriod {
    pub kind: PeriodKind,
    pub year: i64,
    pub quarter: Option<i64>,
    /// Original primitive quarter property. None falls back to numeric quarter for typed constructors.
    #[serde(skip)]
    pub quarter_evidence: Option<WireValue>,
    pub start: String,
    pub end: String,
    pub source: String,
}
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedFiscalPeriod {
    pub period: FiscalPeriod,
    pub company_key: String,
    pub label: String,
    pub key: String,
    pub precision: String,
    pub start: String,
    pub end: String,
}
#[derive(Clone, Debug)]
pub struct FiscalPeriodResult {
    pub year: Result<ResolvedFiscalPeriod, ModelError>,
    pub quarter: Result<ResolvedFiscalPeriod, ModelError>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct PeriodEvidence {
    pub company_key: String,
    pub start: String,
    pub end: String,
    pub source: String,
}
#[derive(Clone, Debug)]
pub struct ScopeWarning {
    pub code: String,
    pub message: String,
    pub category_id: Option<String>,
    pub periods: Vec<PeriodEvidence>,
}
pub(crate) fn error(
    code: &str,
    message: impl Into<String>,
    id: &str,
    records: Vec<String>,
) -> ModelError {
    ModelError {
        record_ids_present: true,
        dependency_ids_present: false,
        code: code.into(),
        message: message.into(),
        definition_id: id.into(),
        record_ids: records,
        dependency_ids: vec![],
    }
}
pub(crate) fn read<'a>(r: &'a DatasetRow, id: Option<&str>) -> &'a WireValue {
    id.and_then(|id| r.values.get(id))
        .unwrap_or(&WireValue::Missing)
}
pub(crate) fn leap(y: i64) -> bool {
    y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)
}
pub(crate) fn days_month(y: i64, m: i64) -> i64 {
    match m {
        2 => {
            if leap(y) {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}
/// The one display spelling of a fiscal period: `FY2026`, `FY2026-Q3`, `FY2026-TTM`.
/// Display only; twin of `formatFiscalLabel` in src/lib/periods.ts.
pub fn fiscal_period_label(year: i64, period: Option<&str>) -> String {
    match period {
        Some(period) => format!("FY{year}-{period}"),
        None => format!("FY{year}"),
    }
}

pub fn period_date(value: &WireValue) -> Option<String> {
    let WireValue::String(s) = value else {
        return None;
    };
    let (y, m, d) = crate::pivot::date_parts(s)?;
    let b = s.as_bytes();
    if b.len() != 10
        && (b.len() < 16
            || b[10] != b'T'
            || b[13] != b':'
            || !b[11..13].iter().chain(&b[14..16]).all(u8::is_ascii_digit))
    {
        return None;
    }
    if y < 1 || !(1..=12).contains(&m) || d < 1 || d > days_month(y, m) {
        return None;
    }
    Some(s[..10].into())
}
pub(crate) fn civil_day(mut y: i64, m: i64, d: i64) -> i64 {
    y += (m - 1).div_euclid(12);
    let m = (m - 1).rem_euclid(12) + 1;
    y -= i64::from(m <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = m + if m > 2 { -3 } else { 9 };
    era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + (153 * mp + 2) / 5 + d - 1 - 719468
}
pub(crate) fn day_date(day: i64) -> String {
    let z = day + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    format!("{:04}-{m:02}-{d:02}", y + i64::from(m <= 2))
}
pub(crate) fn date_day(date: &str) -> i64 {
    civil_day(
        date[..4].parse().unwrap(),
        date[5..7].parse().unwrap(),
        date[8..10].parse().unwrap(),
    )
}
pub fn month_bounds(y: i64, m: i64, length: i64) -> (String, String) {
    let sy = y + (m - 1).div_euclid(12);
    let sm = (m - 1).rem_euclid(12) + 1;
    let em = m + length - 1;
    let ey = y + (em - 1).div_euclid(12);
    let em = (em - 1).rem_euclid(12) + 1;
    (
        format!("{sy:04}-{sm:02}-01"),
        format!("{ey:04}-{em:02}-{:02}", days_month(ey, em)),
    )
}
fn fiscal_number(v: &WireValue, kind: PeriodKind) -> Option<i64> {
    let text = if matches!(v, WireValue::Null | WireValue::Missing) {
        String::new()
    } else {
        value_string(v)
    };
    let t = match kind {
        PeriodKind::FY => text.strip_prefix("FY").unwrap_or(&text),
        PeriodKind::FQ => text
            .strip_prefix("FQ")
            .or_else(|| text.strip_prefix('Q'))
            .unwrap_or(&text),
    };
    let len = match kind {
        PeriodKind::FY => 4,
        PeriodKind::FQ => 1,
    };
    if t.len() != len || !t.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n = t.parse().ok()?;
    match kind {
        PeriodKind::FY if n > 0 => Some(n),
        PeriodKind::FQ if (1..=4).contains(&n) => Some(n),
        _ => None,
    }
}
pub fn resolve_fiscal_period(
    row: &DatasetRow,
    binding: &FiscalBinding,
    context: &FiscalContext,
) -> FiscalPeriodResult {
    let err = |code: &str, msg: &str| error(code, msg, "", vec![row.id.clone()]);
    let fail = |code: &str, msg: String| Err(err(code, &msg));
    let both = |code: &str, msg: &str| FiscalPeriodResult {
        year: fail(code, msg.into()),
        quarter: fail(code, msg.into()),
    };
    let WireValue::String(company) = read(row, Some(&binding.company_field_id)) else {
        return both(
            "fiscal-context",
            "Bind a company and report date for fiscal categories.",
        );
    };
    if company.is_empty() || binding.date_field_id.is_none() {
        return both(
            "fiscal-context",
            "Bind a company and report date for fiscal categories.",
        );
    }
    let Some(date) = period_date(read(row, binding.date_field_id.as_deref())) else {
        return both(
            "invalid-date",
            "The bound report date is missing or invalid.",
        );
    };
    let metadata = if let Some(key) = &binding.metadata_key {
        context.metadata.as_ref().and_then(|m| m.get(key))
    } else {
        context.companies.as_ref()
    };
    let info = metadata.and_then(|m| m.get(company));
    let override_ = context.overrides.as_ref().and_then(|m| m.get(company));
    let periods: Vec<_> = info
        .into_iter()
        .chain(override_)
        .flat_map(|i| &i.periods)
        .collect();
    let has_fields = binding.period_kind.is_some()
        || binding.fiscal_year_field_id.is_some()
        || binding.fiscal_quarter_field_id.is_some()
        || binding.period_start_field_id.is_some()
        || binding.period_end_field_id.is_some();
    let mut bound = None;
    let mut year_error = None;
    let mut quarter_error = None;
    if has_fields {
        let year = fiscal_number(
            read(row, binding.fiscal_year_field_id.as_deref()),
            PeriodKind::FY,
        );
        let quarter = fiscal_number(
            read(row, binding.fiscal_quarter_field_id.as_deref()),
            PeriodKind::FQ,
        );
        let start = period_date(read(row, binding.period_start_field_id.as_deref()));
        let end = period_date(read(row, binding.period_end_field_id.as_deref()));
        if year.is_none() {
            let e = err(
                "fiscal-context",
                "The bound fiscal year label is missing or invalid.",
            );
            year_error = Some(e.clone());
            quarter_error = Some(e);
        } else if start.is_none()
            || end.is_none()
            || start > end
            || date < *start.as_ref().unwrap()
            || date > *end.as_ref().unwrap()
        {
            let e = err(
                "invalid-date",
                "The bound fiscal period dates are invalid or do not contain the report date.",
            );
            year_error = Some(e.clone());
            quarter_error = Some(e);
        } else {
            let start = start.unwrap();
            let end = end.unwrap();
            let annual_span =
                [364, 365, 366, 371].contains(&(date_day(&end) - date_day(&start) + 1));
            let kind = binding.period_kind.or(if quarter.is_some() {
                Some(PeriodKind::FQ)
            } else if binding.fiscal_quarter_field_id.is_none() || annual_span {
                Some(PeriodKind::FY)
            } else {
                None
            });
            if kind == Some(PeriodKind::FY) || kind == Some(PeriodKind::FQ) && quarter.is_some() {
                bound = Some(FiscalPeriod {
                    kind: kind.unwrap(),
                    year: year.unwrap_or_default(),
                    quarter_evidence: None,
                    quarter: if kind == Some(PeriodKind::FQ) {
                        quarter
                    } else {
                        None
                    },
                    start,
                    end,
                    source: "bound period fields".into(),
                });
            } else {
                year_error = Some(err(
                    "fiscal-context",
                    "The bound dates do not identify an annual period. Declare their period kind.",
                ));
            }
            if quarter.is_none() {
                quarter_error = Some(err(
                    "fiscal-context",
                    "The bound fiscal quarter label is missing or invalid.",
                ));
            }
        }
    }
    let resolved = |p: FiscalPeriod, precision: &str| {
        // The key stays `FY2026 Q3`: it is the member value formulas and saved views store.
        let quarter =
            (p.kind == PeriodKind::FQ).then(|| format!("Q{}", quarter_number(&p).unwrap()));
        let key = format!(
            "FY{}{}",
            p.year,
            quarter
                .as_ref()
                .map(|q| format!(" {q}"))
                .unwrap_or_default()
        );
        Ok(ResolvedFiscalPeriod {
            company_key: company.clone(),
            key,
            label: fiscal_period_label(p.year, quarter.as_deref()),
            precision: precision.into(),
            start: p.start.clone(),
            end: p.end.clone(),
            period: p,
        })
    };
    let resolve = |kind: PeriodKind| {
        let mut matches = vec![];
        for p in periods.iter().filter(|p| p.kind == kind) {
            let start = period_date(&WireValue::String(p.start.clone()));
            let end = period_date(&WireValue::String(p.end.clone()));
            if start.is_none() || end.is_none() || start > end {
                return fail(
                    "invalid-date",
                    "Authoritative fiscal period bounds are invalid.".into(),
                );
            }
            if !(1..=9999).contains(&p.year)
                || kind == PeriodKind::FQ
                    && !quarter_number(p).is_some_and(|q| (1..=4).contains(&q))
            {
                return fail(
                    "fiscal-context",
                    "Authoritative fiscal period labels are invalid.".into(),
                );
            }
            if kind == PeriodKind::FY
                && matches!(
                    quarter_value(p).as_ref(),
                    WireValue::Array(_) | WireValue::Record(_)
                )
            {
                return fail("fiscal-context","Compound FY quarter evidence requires object-reference identity, which this wire contract does not preserve.".into());
            }
            let mut p = (*p).clone();
            p.start = start.unwrap();
            p.end = end.unwrap();
            if p.start <= date && p.end >= date {
                matches.push(p)
            }
        }
        if let Some(first) = matches.first() {
            if matches.len() > 1
                && matches.iter().any(|p| {
                    p.year != first.year
                        || !quarter_equal(p, first)
                        || p.start != first.start
                        || p.end != first.end
                })
            {
                return fail(
                    "fiscal-context",
                    "Authoritative fiscal periods overlap ambiguously.".into(),
                );
            }
            return resolved(first.clone(), "authoritative");
        }
        if let Some(e) = if kind == PeriodKind::FY {
            &year_error
        } else {
            &quarter_error
        } {
            return Err(e.clone());
        }
        if let Some(p) = bound.as_ref().filter(|p| p.kind == kind) {
            return resolved(p.clone(), "authoritative");
        }
        if !periods.is_empty()
            || has_fields
            || info.is_some_and(|i| i.calendar.as_deref() == Some("week"))
            || override_.is_some_and(|i| i.calendar.as_deref() == Some("week"))
        {
            return fail(
                "fiscal-context",
                format!("Authoritative {kind:?} bounds are unavailable for {company} on {date}."),
            );
        }
        let setting = override_.or(info);
        let Some(end_month) = setting
            .and_then(|s| s.year_end_month)
            .filter(|m| (1..=12).contains(m))
        else {
            return fail(
                "fiscal-context",
                format!("Fiscal calendar is unavailable for {company}."),
            );
        };
        let y: i64 = date[..4].parse().unwrap();
        let month: i64 = date[5..7].parse().unwrap();
        let fy = y + i64::from(month > end_month);
        let start_year = fy - i64::from(end_month != 12);
        let start_month = if end_month == 12 { 1 } else { end_month + 1 };
        let q = (month - start_month + 12) % 12 / 3 + 1;
        let (start, end) = month_bounds(
            start_year,
            start_month
                + if kind == PeriodKind::FQ {
                    (q - 1) * 3
                } else {
                    0
                },
            if kind == PeriodKind::FY { 12 } else { 3 },
        );
        resolved(
            FiscalPeriod {
                kind,
                year: fy,
                quarter_evidence: None,
                quarter: if kind == PeriodKind::FQ {
                    Some(q)
                } else {
                    None
                },
                start,
                end,
                source: setting.unwrap().source.clone(),
            },
            "month-calendar",
        )
    };
    FiscalPeriodResult {
        year: resolve(PeriodKind::FY),
        quarter: resolve(PeriodKind::FQ),
    }
}
pub fn alignment_warnings(periods: &[ResolvedFiscalPeriod]) -> Vec<ScopeWarning> {
    let mut groups: Vec<(String, Vec<&ResolvedFiscalPeriod>)> = vec![];
    for p in periods {
        let key = format!("{:?}/{}", p.period.kind, p.key);
        let idx = groups
            .iter()
            .position(|(k, _)| k == &key)
            .unwrap_or_else(|| {
                groups.push((key, vec![]));
                groups.len() - 1
            });
        if !groups[idx].1.iter().any(|o| {
            o.company_key == p.company_key
                && o.start == p.start
                && o.end == p.end
                && o.period.source == p.period.source
        }) {
            groups[idx].1.push(p)
        }
    }
    groups.into_iter().filter(|(_,g)|g.iter().any(|p|p.company_key!=g[0].company_key)&&g.iter().any(|p|p.start!=g[0].start||p.end!=g[0].end)).map(|(_,g)|ScopeWarning{code:"fiscal-alignment".into(),message:format!("Fiscal periods do not align across companies. {} represents different date ranges.",g[0].label),category_id:None,periods:g.into_iter().map(|p|PeriodEvidence{company_key:p.company_key.clone(),start:p.start.clone(),end:p.end.clone(),source:p.period.source.clone()}).collect()}).collect()
}
/// Strict typed metadata seam. Parsing does not coerce cells or evaluate JSON values.
pub fn parse_fiscal_context(value: &WireValue) -> Result<FiscalContext, Vec<ModelError>> {
    let invalid = || {
        vec![error(
            "fiscal-context",
            "Explicit fiscal context metadata is invalid; repair the company calendar mapping.",
            "",
            vec![],
        )]
    };
    if matches!(value, WireValue::Missing) {
        return Ok(FiscalContext::default());
    }
    fn record(v: &WireValue) -> Option<&[(String, WireValue)]> {
        if let WireValue::Record(r) = v {
            let mut names = std::collections::BTreeSet::new();
            if r.iter().all(|(k, _)| names.insert(k)) {
                Some(r)
            } else {
                None
            }
        } else {
            None
        }
    }
    fn text(v: Option<&WireValue>) -> Option<String> {
        if let Some(WireValue::String(s)) = v {
            Some(s.clone())
        } else {
            None
        }
    }
    fn int(v: Option<&WireValue>) -> Option<i64> {
        v.and_then(number)
            .filter(|n| n.is_finite() && n.fract() == 0. && *n >= 0. && *n <= 9999.)
            .map(|n| n as i64)
    }
    fn get<'a>(r: &'a [(String, WireValue)], k: &str) -> Option<&'a WireValue> {
        r.iter().find(|(id, _)| id == k).map(|(_, v)| v)
    }
    fn companies(v: &WireValue) -> Option<FiscalCompanies> {
        record(v)?
            .iter()
            .map(|(key, v)| {
                let r = record(v)?;
                if r.iter().any(|(k, _)| {
                    !["source", "yearEndMonth", "calendar", "periods"].contains(&k.as_str())
                }) {
                    return None;
                }
                let source = text(get(r, "source")).filter(|s| !s.is_empty())?;
                let year_end_month = match get(r, "yearEndMonth") {
                    None => None,
                    Some(v) => Some(int(Some(v)).filter(|m| (1..=12).contains(m))?),
                };
                let calendar = match get(r, "calendar") {
                    None => None,
                    Some(v) => Some(text(Some(v)).filter(|s| s == "month" || s == "week")?),
                };
                let periods = match get(r, "periods") {
                    None => vec![],
                    Some(WireValue::Array(a)) => a
                        .iter()
                        .map(|v| {
                            let p = record(v)?;
                            let kind = match text(get(p, "kind"))?.as_str() {
                                "FY" => PeriodKind::FY,
                                "FQ" => PeriodKind::FQ,
                                _ => return None,
                            };
                            let year = int(get(p, "year")).filter(|y| *y > 0)?;
                            let quarter = int(get(p, "quarter"));
                            if kind == PeriodKind::FQ
                                && !quarter.is_some_and(|q| (1..=4).contains(&q))
                            {
                                return None;
                            }
                            let start = text(get(p, "start"))?;
                            let end = text(get(p, "end"))?;
                            if period_date(&WireValue::String(start.clone())).is_none()
                                || period_date(&WireValue::String(end.clone())).is_none()
                                || start > end
                            {
                                return None;
                            }
                            Some(FiscalPeriod {
                                kind,
                                year,
                                quarter,
                                quarter_evidence: get(p, "quarter").cloned(),
                                start,
                                end,
                                source: text(get(p, "source"))?,
                            })
                        })
                        .collect::<Option<Vec<_>>>()?,
                    _ => return None,
                };
                Some((
                    key.clone(),
                    FiscalCompanyContext {
                        year_end_month,
                        calendar,
                        source,
                        periods,
                    },
                ))
            })
            .collect()
    }
    // boundedPlainData's graph budget, including arrays' own length property.
    crate::validation::validate_original_recipe_graph(value).map_err(|_| invalid())?;
    fn compound_fy(v: &WireValue) -> bool {
        record(v).into_iter().flatten().any(|(_, company)| {
            let Some(WireValue::Array(periods)) = record(company).and_then(|c| get(c, "periods"))
            else {
                return false;
            };
            periods.iter().any(|period| {
                record(period).is_some_and(|p| {
                    matches!(get(p,"kind"),Some(WireValue::String(kind))if kind=="FY")
                        && matches!(
                            get(p, "quarter"),
                            Some(WireValue::Array(_) | WireValue::Record(_))
                        )
                })
            })
        })
    }
    let parse_companies = |v: &WireValue| {
        if compound_fy(v) {
            Err(vec![error("fiscal-context","Compound FY quarter evidence requires object-reference identity, which this wire contract does not preserve.","",vec![])])
        } else {
            companies(v).ok_or_else(invalid)
        }
    };
    let r = record(value).ok_or_else(invalid)?;
    let mut result = FiscalContext::default();
    for (key, v) in r {
        match key.as_str() {
            "companies" => result.companies = Some(parse_companies(v)?),
            "overrides" => result.overrides = Some(parse_companies(v)?),
            "metadata" => {
                result.metadata = Some(
                    record(v)
                        .ok_or_else(invalid)?
                        .iter()
                        .map(|(k, v)| parse_companies(v).map(|c| (k.clone(), c)))
                        .collect::<Result<BTreeMap<_, _>, _>>()?,
                )
            }
            _ => return Err(invalid()),
        }
    }
    Ok(result)
}

pub(crate) fn quarter_value(period: &FiscalPeriod) -> std::borrow::Cow<'_, WireValue> {
    period
        .quarter_evidence
        .as_ref()
        .map(std::borrow::Cow::Borrowed)
        .unwrap_or_else(|| {
            std::borrow::Cow::Owned(
                period
                    .quarter
                    .map(|q| WireValue::F64(WireNumber::Finite(q as f64)))
                    .unwrap_or(WireValue::Missing),
            )
        })
}
fn quarter_number(period: &FiscalPeriod) -> Option<i64> {
    number(quarter_value(period).as_ref())
        .filter(|q| q.is_finite() && q.fract() == 0. && (1.0..=4.0).contains(q))
        .map(|q| q as i64)
}
fn quarter_equal(a: &FiscalPeriod, b: &FiscalPeriod) -> bool {
    let a = quarter_value(a);
    let b = quarter_value(b);
    if let (Some(a), Some(b)) = (number(&a), number(&b)) {
        a == b
    } else {
        a == b
    }
}
#[allow(clippy::result_large_err)]
pub(crate) fn quarter_recipe_json(period: &FiscalPeriod) -> Result<String, Diagnostic> {
    let quarter = quarter_value(period);
    if period.kind == PeriodKind::FY
        && matches!(quarter.as_ref(), WireValue::Array(_) | WireValue::Record(_))
    {
        return Err(crate::validation::diagnostic("fiscal-context","fiscalContext.periods.quarter","Compound FY quarter evidence requires object-reference identity, which this wire contract does not preserve."));
    }
    crate::validation::ordered_recipe_json(quarter.as_ref())
}

impl crate::session::resources::HeapBytes for FiscalCompanies {
    fn heap_bytes(&self) -> usize {
        let Self { entries, index } = self;
        crate::session::resources::HeapBytes::heap_bytes(entries)
            .saturating_add(crate::session::resources::HeapBytes::heap_bytes(index))
    }
}
