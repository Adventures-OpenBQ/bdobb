// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
#[allow(clippy::result_large_err)]
pub fn compile_statement(
    i: &StatementIntent,
    columns: &[DatasetColumn],
) -> Result<EffectiveStatement, Diagnostic> {
    validate_intent(i)?;
    let b = &i.bindings;
    let p = prefix(i);
    let item = format!("{p}category/item");
    let section = format!("{p}category/section");
    let period = format!("{p}category/period");
    let value = format!("{p}measure/value");
    let mut carry = vec![b.company_field_id.clone(), b.period_kind_field_id.clone()];
    carry.extend(b.currency_field_id.clone());
    carry.extend(b.unit_field_id.clone());
    carry.extend(fiscal_fields(&b.fiscal));
    let mut seen = std::collections::BTreeSet::new();
    carry.retain(|s| seen.insert(s.clone()));
    let mut required = carry.clone();
    if b.shape == StatementShape::Wide {
        required.extend(b.mappings.iter().map(|m| m.source_field_id.clone()));
    } else {
        let f = b.long_fields.as_ref().unwrap();
        required.extend([f.item_field_id.clone(), f.value_field_id.clone()]);
    }
    for field in required {
        if !columns.iter().any(|c| c.id == field) {
            return Err(problem(
                "missing-reference",
                "bindings",
                &format!("Presented source field {field} is unavailable; restore or rebind it."),
            ));
        }
    }
    let date = b.fiscal.date_field_id.clone().ok_or_else(|| {
        problem(
            "missing-reference",
            "bindings",
            "Bind a report date to execute the selected fiscal period.",
        )
    })?;
    if (b.fiscal.period_kind.is_some()
        || b.fiscal.fiscal_year_field_id.is_some()
        || b.fiscal.fiscal_quarter_field_id.is_some()
        || b.fiscal.period_start_field_id.is_some()
        || b.fiscal.period_end_field_id.is_some())
        && (b.fiscal.fiscal_year_field_id.is_none()
            || b.fiscal.period_start_field_id.is_none()
            || b.fiscal.period_end_field_id.is_none()
            || (i.period_kind == PeriodKind::FQ && b.fiscal.fiscal_quarter_field_id.is_none()))
    {
        return Err(problem(
            "missing-reference",
            "bindings",
            "Explicit fiscal bindings require year, start/end bounds and a quarter for FQ.",
        ));
    }
    let section_field = format!("{p}field/section");
    let (item_field, value_field) = if let Some(f) = &b.long_fields {
        (f.item_field_id.clone(), f.value_field_id.clone())
    } else {
        (format!("{p}field/item"), format!("{p}field/value"))
    };
    let section_by_line: BTreeMap<_, _> = i
        .template
        .sections
        .iter()
        .flat_map(|s| s.line_ids.iter().map(|l| (l.clone(), s.id.clone())))
        .collect();
    let selectors = |id: &str| {
        vec![
            MemberSelector {
                category_id: section.clone(),
                member_key: key(&section_by_line[id]),
            },
            MemberSelector {
                category_id: item.clone(),
                member_key: key(id),
            },
        ]
    };
    fn map(
        ast: &FormulaAst,
        active: Option<&str>,
        item: &str,
        i: &StatementIntent,
        selectors: &dyn Fn(&str) -> Vec<MemberSelector>,
    ) -> Result<FormulaAst, Diagnostic> {
        Ok(match ast {
            FormulaAst::Reference {
                target: ReferenceTarget::Measure,
                ..
            } => {
                let id = active.ok_or_else(|| {
                    problem(
                        "missing-reference",
                        "formulas",
                        "Bind Value to an explicit line member in aggregate formulas.",
                    )
                })?;
                i.template
                    .lines
                    .iter()
                    .find(|l| l.id == id)
                    .and_then(|l| l.formula.as_ref())
                    .map(|f| FormulaAst::Reference {
                        target: ReferenceTarget::Formula,
                        id: f.id.clone(),
                    })
                    .unwrap_or_else(|| ast.clone())
            }
            FormulaAst::Member {
                value,
                selectors: s,
            } => {
                let active = s
                    .iter()
                    .find(|s| s.category_id == item)
                    .map(|s| s.member_key.as_str())
                    .or(active);
                FormulaAst::Member {
                    value: Box::new(map(value, active, item, i, selectors)?),
                    selectors: s
                        .iter()
                        .flat_map(|s| {
                            if s.category_id == item {
                                selectors(&s.member_key)
                            } else {
                                vec![s.clone()]
                            }
                        })
                        .collect(),
                }
            }
            FormulaAst::Binary {
                operator,
                left,
                right,
            } => FormulaAst::Binary {
                operator: *operator,
                left: Box::new(map(left, active, item, i, selectors)?),
                right: Box::new(map(right, active, item, i, selectors)?),
            },
            FormulaAst::Unary { operator, operand } => FormulaAst::Unary {
                operator: *operator,
                operand: Box::new(map(operand, active, item, i, selectors)?),
            },
            FormulaAst::Call { function, args } => FormulaAst::Call {
                function: *function,
                args: args
                    .iter()
                    .map(|a| map(a, active, item, i, selectors))
                    .collect::<Result<_, _>>()?,
            },
            _ => ast.clone(),
        })
    }
    let mut formulas: Vec<Formula> = i
        .template
        .lines
        .iter()
        .filter_map(|l| l.formula.clone())
        .collect();
    for f in &i.overrides.formulas {
        if let Some(old) = formulas.iter_mut().find(|old| old.id == f.id) {
            *old = f.clone();
        } else {
            formulas.push(f.clone());
        }
    }
    for f in &mut formulas {
        f.ast = map(&f.ast, None, &item, i, &selectors)?;
    }
    let sections = i
        .overrides
        .section_order
        .clone()
        .unwrap_or_else(|| i.template.sections.iter().map(|s| s.id.clone()).collect());
    let lines: Vec<String> = sections
        .iter()
        .flat_map(|id| {
            i.overrides.line_order.get(id).cloned().unwrap_or_else(|| {
                i.template
                    .sections
                    .iter()
                    .find(|s| &s.id == id)
                    .unwrap()
                    .line_ids
                    .clone()
            })
        })
        .collect();
    let category =
        |id: String, name: &str, field: String, transform: Transform, fiscal_binding| Category {
            id,
            name: name.into(),
            source_field_id: field,
            transform,
            fiscal_binding,
            legacy_bucket: None,
        };
    let model = TableModel {
        schema_version: 1,
        enabled: true,
        params: PivotParams {
            promote_page: false,
            filters: vec![],
        },
        categories: vec![
            category(
                section.clone(),
                "Section",
                section_field.clone(),
                Transform::Native,
                None,
            ),
            category(
                item.clone(),
                "Line item",
                item_field.clone(),
                Transform::Native,
                None,
            ),
            category(
                format!("{p}category/company"),
                "Company",
                b.company_field_id.clone(),
                Transform::Native,
                None,
            ),
            category(
                period,
                if i.period_kind == PeriodKind::FY {
                    "FY"
                } else {
                    "FQ"
                },
                date,
                if i.period_kind == PeriodKind::FY {
                    Transform::FY
                } else {
                    Transform::FQ
                },
                Some(b.fiscal.clone()),
            ),
        ],
        measures: vec![Measure {
            id: value.clone(),
            source_field_id: value_field.clone(),
            aggregation: Some(Aggregation::Sum),
            custom_label: Some("Value".into()),
        }],
        formulas: formulas.clone(),
        layout: Layout {
            rows: vec![section.clone(), item.clone()],
            columns: vec![format!("{p}category/period")],
            values: vec![value.clone()],
            page: i.page.clone(),
        },
        checklists: i
            .checklists
            .iter()
            .map(|c| MemberConstraint {
                category_id: c.category_id.clone(),
                member_keys: c
                    .member_keys
                    .iter()
                    .map(|s| {
                        if c.category_id == item {
                            key(s)
                        } else {
                            s.clone()
                        }
                    })
                    .collect(),
            })
            .collect(),
        result_filters: i.result_filters.clone(),
        subtotals: Subtotals {
            groups: false,
            grand_total: false,
        },
        legacy_pivot: None,
    };
    let scope_members: Vec<DeclaredMember> = i
        .template
        .lines
        .iter()
        .filter_map(|l| {
            l.formula.as_ref().map(|f| DeclaredMember {
                selectors: selectors(&l.id),
                formula_id: Some(f.id.clone()),
            })
        })
        .collect();
    let output_members = lines
        .iter()
        .filter_map(|id| {
            let l = i.template.lines.iter().find(|l| &l.id == id).unwrap();
            let available = b.shape == StatementShape::Long
                || b.mappings.iter().any(|m| m.line_id == l.id)
                || l.required
                || l.formula.is_some();
            if !available
                || i.overrides.hidden_ids.contains(id)
                || i.overrides.hidden_ids.contains(&section_by_line[id])
                || i.checklists
                    .iter()
                    .any(|c| c.category_id == item && !c.member_keys.contains(id))
            {
                return None;
            }
            let authored = l
                .formula
                .as_ref()
                .and_then(|f| formulas.iter().find(|v| v.id == f.id))
                .and_then(|f| f.format.as_deref())
                .or(l.format.as_deref());
            let formatter = authored
                .map(|s| match s {
                    "percent" => "normalizedPercent",
                    "integer" => "int",
                    "decimal" | "number" => "none",
                    s => s,
                })
                .filter(|s| {
                    [
                        "int",
                        "none",
                        "normalized",
                        "normalizedPercent",
                        "dateToYear",
                    ]
                    .contains(s)
                });
            Some(OutputMember {
                selectors: selectors(id),
                formula_id: l.formula.as_ref().map(|f| f.id.clone()),
                require_observed: b.shape == StatementShape::Long
                    && !l.required
                    && l.formula.is_none(),
                format: formatter.map(|s| CellFormat {
                    formatter_fn: Some(s.into()),
                    decimal_places: None,
                    abbreviate: None,
                }),
            })
        })
        .collect();
    let label =
        |id: &String, l: &String| (key(id), i.overrides.labels.get(id).unwrap_or(l).clone());
    let execution = ExecutionDescriptor {
        member_orders: BTreeMap::from([
            (section.clone(), sections.iter().map(|s| key(s)).collect()),
            (item.clone(), lines.iter().map(|s| key(s)).collect()),
        ]),
        member_labels: BTreeMap::from([
            (
                section.clone(),
                i.template
                    .sections
                    .iter()
                    .map(|s| label(&s.id, &s.label))
                    .collect(),
            ),
            (
                item.clone(),
                i.template
                    .lines
                    .iter()
                    .map(|s| label(&s.id, &s.label))
                    .collect(),
            ),
        ]),
        scope_members,
        output_members,
        policy: StatementPolicy {
            category_id: item,
            dependent_category_ids: vec![section, format!("{p}category/item")],
            measure_id: value,
            value_field_id: value_field.clone(),
            members: i
                .template
                .lines
                .iter()
                .map(|l| (key(&l.id), l.policy))
                .collect(),
            formulas: i
                .template
                .lines
                .iter()
                .filter_map(|l| l.formula.as_ref().map(|f| (key(&l.id), f.id.clone())))
                .collect(),
            required: i
                .template
                .lines
                .iter()
                .map(|l| (key(&l.id), l.required))
                .collect(),
            period_kind: i.period_kind,
            company_field_id: b.company_field_id.clone(),
            currency_field_id: b.currency_field_id.clone(),
            unit_field_id: b.unit_field_id.clone(),
            fiscal: b.fiscal.clone(),
        },
        source_columns_by_row_id: BTreeMap::new(),
    };
    let unpivot = (b.shape == StatementShape::Wide).then(|| UnpivotSpec {
        id: format!("{p}unpivot"),
        carry_field_ids: carry,
        mappings: b.mappings.clone(),
        item_field_id: item_field,
        value_field_id: value_field,
    });
    Ok(EffectiveStatement {
        model,
        execution,
        unpivot,
        section_field,
        section_by_line,
    })
}
