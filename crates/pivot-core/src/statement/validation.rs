// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use std::collections::BTreeSet;
#[allow(clippy::result_large_err)]
pub fn validate_intent(i: &StatementIntent) -> Result<(), Diagnostic> {
    let fail = |path: &str, msg: &str| problem("invalid-structure", path, msg);
    let unique = |v: Vec<&str>, path: &str| -> Result<(), Diagnostic> {
        let mut seen = BTreeSet::new();
        if v.into_iter()
            .any(|s| !seen.insert(s) || s.trim().is_empty())
        {
            Err(problem("duplicate-id", path, "Duplicate ID."))
        } else {
            Ok(())
        }
    };
    if i.schema_version != 2 || i.template.schema_version != 1 {
        return Err(problem(
            "unsupported-schema",
            "schemaVersion",
            "Unsupported statement schema.",
        ));
    }
    if i.kind != "statement"
        || i.template.id.trim().is_empty()
        || i.template.version.trim().is_empty()
    {
        return Err(fail("template", "Invalid template snapshot."));
    }
    let p = prefix(i);
    let lines: BTreeSet<_> = i.template.lines.iter().map(|l| l.id.as_str()).collect();
    let sections: BTreeSet<_> = i.template.sections.iter().map(|s| s.id.as_str()).collect();
    let categories = BTreeSet::from([
        format!("{p}category/item"),
        format!("{p}category/company"),
        format!("{p}category/period"),
    ]);
    unique(
        i.template.lines.iter().map(|l| l.id.as_str()).collect(),
        "template.lines",
    )?;
    unique(
        i.template.sections.iter().map(|s| s.id.as_str()).collect(),
        "template.sections",
    )?;
    for l in &i.template.lines {
        if !l.id.starts_with(&format!("{p}line/"))
            || l.label.trim().is_empty()
            || ((l.policy == LinePolicy::Formula) != l.formula.is_some())
            || [&l.format, &l.unit]
                .into_iter()
                .flatten()
                .any(|s| s.trim().is_empty())
        {
            return Err(fail("template.lines", "Invalid owned line."));
        }
    }
    let assigned: Vec<_> = i
        .template
        .sections
        .iter()
        .flat_map(|s| s.line_ids.iter().map(String::as_str))
        .collect();
    unique(assigned.clone(), "template.sections")?;
    if assigned.iter().copied().collect::<BTreeSet<_>>() != lines {
        return Err(fail(
            "template.sections",
            "Each line must belong to exactly one section.",
        ));
    }
    for s in &i.template.sections {
        if !s.id.starts_with(&format!("{p}section/")) || s.label.trim().is_empty() {
            return Err(fail("template.sections", "Invalid owned section."));
        }
    }
    let b = &i.bindings;
    if b.company_field_id != b.fiscal.company_field_id
        || b.fiscal.period_kind.is_some_and(|k| k != i.period_kind)
    {
        return Err(fail(
            "bindings.fiscal",
            "Invalid or contradictory fiscal binding.",
        ));
    }
    let identity: Vec<_> = [
        Some(&b.company_field_id),
        Some(&b.period_kind_field_id),
        b.currency_field_id.as_ref(),
        b.unit_field_id.as_ref(),
    ]
    .into_iter()
    .flatten()
    .map(String::as_str)
    .collect();
    unique(identity.clone(), "bindings")?;
    for f in fiscal_fields(&b.fiscal) {
        if f.trim().is_empty() {
            return Err(fail(
                "bindings.fiscal",
                "Invalid or contradictory fiscal binding.",
            ));
        }
    }
    if b.shape == StatementShape::Long {
        let f = b.long_fields.as_ref().ok_or_else(|| {
            fail(
                "bindings.longFields",
                "Long input requires distinct item/value fields.",
            )
        })?;
        if f.item_field_id == f.value_field_id
            || f.item_field_id.trim().is_empty()
            || f.value_field_id.trim().is_empty()
        {
            return Err(fail(
                "bindings.longFields",
                "Long input requires distinct item/value fields.",
            ));
        }
    } else if b.long_fields.is_some() {
        return Err(fail(
            "bindings.longFields",
            "Wide input cannot declare long fields.",
        ));
    }
    unique(
        b.mappings.iter().map(|m| m.line_id.as_str()).collect(),
        "bindings.mappings",
    )?;
    for m in &b.mappings {
        if m.source_field_id.trim().is_empty()
            || identity.contains(&m.source_field_id.as_str())
            || !lines.contains(m.line_id.as_str())
            || i.template
                .lines
                .iter()
                .any(|l| l.id == m.line_id && l.formula.is_some())
        {
            return Err(fail("bindings.mappings", "Invalid explicit mapping."));
        }
    }
    let o = &i.overrides;
    unique(
        o.hidden_ids.iter().map(String::as_str).collect(),
        "overrides.hiddenIds",
    )?;
    for id in o.hidden_ids.iter().chain(o.labels.keys()) {
        if !lines.contains(id.as_str()) && !sections.contains(id.as_str()) {
            return Err(problem(
                "missing-reference",
                "overrides",
                "Unknown or unowned reference.",
            ));
        }
    }
    // Presentation's text bound: at most 4096 UTF-16 units.
    if o.labels
        .values()
        .any(|s| s.trim().is_empty() || s.encode_utf16().count() > 4096)
    {
        return Err(fail(
            "overrides.labels",
            "Expected a nonempty label of at most 4096 characters.",
        ));
    }
    if let Some(order) = &o.section_order {
        unique(
            order.iter().map(String::as_str).collect(),
            "overrides.sectionOrder",
        )?;
        if order.iter().map(String::as_str).collect::<BTreeSet<_>>() != sections {
            return Err(fail(
                "overrides.sectionOrder",
                "Order must include each section.",
            ));
        }
    }
    for (section, order) in &o.line_order {
        let s = i
            .template
            .sections
            .iter()
            .find(|s| &s.id == section)
            .ok_or_else(|| fail("overrides.lineOrder", "Unknown section or invalid order."))?;
        unique(
            order.iter().map(String::as_str).collect(),
            "overrides.lineOrder",
        )?;
        if order.iter().collect::<BTreeSet<_>>() != s.line_ids.iter().collect::<BTreeSet<_>>() {
            return Err(fail(
                "overrides.lineOrder",
                "Order must include every section line.",
            ));
        }
    }
    let pinned: Vec<_> = i
        .template
        .lines
        .iter()
        .filter_map(|l| l.formula.as_ref())
        .collect();
    unique(
        pinned.iter().map(|f| f.id.as_str()).collect(),
        "template.formulas",
    )?;
    unique(
        o.formulas.iter().map(|f| f.id.as_str()).collect(),
        "overrides.formulas",
    )?;
    let formula_ids: BTreeSet<_> = pinned.iter().map(|f| f.id.as_str()).collect();
    fn refs(
        ast: &FormulaAst,
        formulas: &BTreeSet<&str>,
        categories: &BTreeSet<String>,
        lines: &BTreeSet<&str>,
        p: &str,
    ) -> Result<(), Diagnostic> {
        let reference = |valid| {
            if valid {
                Ok(())
            } else {
                Err(problem(
                    "missing-reference",
                    "formulas",
                    "Unknown or unowned reference.",
                ))
            }
        };
        match ast {
            FormulaAst::Reference { target, id } => reference(match target {
                ReferenceTarget::Formula => formulas.contains(id.as_str()),
                ReferenceTarget::Measure => id == &format!("{p}measure/value"),
                _ => false,
            }),
            FormulaAst::Unary { operand, .. } => refs(operand, formulas, categories, lines, p),
            FormulaAst::Binary { left, right, .. } => {
                refs(left, formulas, categories, lines, p)?;
                refs(right, formulas, categories, lines, p)
            }
            FormulaAst::Call { args, .. } => {
                for a in args {
                    refs(a, formulas, categories, lines, p)?;
                }
                Ok(())
            }
            FormulaAst::Member { value, selectors } => {
                let mut seen = BTreeSet::new();
                for s in selectors {
                    reference(
                        categories.contains(&s.category_id)
                            && seen.insert(&s.category_id)
                            && (s.category_id != format!("{p}category/item")
                                || lines.contains(s.member_key.as_str())),
                    )?;
                }
                refs(value, formulas, categories, lines, p)
            }
            _ => Ok(()),
        }
    }
    for f in pinned.into_iter().chain(o.formulas.iter()) {
        if !f.id.starts_with(&format!("{p}formula/"))
            || f.name.trim().is_empty()
            || f.expression.len() > 16384
            || !formula_ids.contains(f.id.as_str())
        {
            return Err(fail("formulas", "Invalid owned formula."));
        }
        let diagnostics = crate::formulas::validate_ast(&f.ast);
        if let Err(d) = diagnostics {
            return Err(problem(&d.code, "formulas.ast", &d.message));
        }
        refs(&f.ast, &formula_ids, &categories, &lines, &p)?;
    }
    let selection = |c: &MemberConstraint| -> Result<(), Diagnostic> {
        if !categories.contains(&c.category_id) {
            return Err(problem(
                "missing-reference",
                "selection",
                "Unknown or unowned reference.",
            ));
        }
        unique(
            c.member_keys.iter().map(String::as_str).collect(),
            "selection.memberKeys",
        )?;
        if c.category_id == format!("{p}category/item")
            && c.member_keys.iter().any(|k| !lines.contains(k.as_str()))
        {
            return Err(problem(
                "missing-reference",
                "selection",
                "Unknown or unowned reference.",
            ));
        }
        Ok(())
    };
    if let Some(c) = &i.page {
        selection(c)?;
    }
    unique(
        i.checklists
            .iter()
            .map(|c| c.category_id.as_str())
            .collect(),
        "checklists",
    )?;
    for c in &i.checklists {
        selection(c)?;
    }
    unique(
        i.result_filters.iter().map(|f| f.id.as_str()).collect(),
        "resultFilters",
    )?;
    for f in &i.result_filters {
        let valid = categories.contains(&f.category_id)
            && match &f.target {
                ResultTarget::Formula { id } => formula_ids.contains(id.as_str()),
                ResultTarget::Measure { id } => id == &format!("{p}measure/value"),
            };
        if !valid {
            return Err(problem(
                "missing-reference",
                "resultFilters",
                "Unknown or unowned reference.",
            ));
        }
    }
    Ok(())
}
