// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
struct Entry {
    field: String,
    scope: CalculationScope,
    value: WireValue,
    has_column: bool,
}
/// Per evaluator only. Two successful, direct-field sums; no caller errors/formats.
pub(super) struct SharedSums {
    fields: BTreeSet<String>,
    entries: Vec<Entry>,
}
impl SharedSums {
    pub(super) fn new(model: &CompiledModel) -> Self {
        let mut counts = BTreeMap::<String, usize>::new();
        if model.execution.is_none() && model.graph.entries.len() <= 64 {
            for f in model
                .graph
                .entries
                .iter()
                .filter_map(|e| e.value.as_ref())
                .filter(|f| {
                    f.scope == FormulaScope::Aggregate
                        && model.graph.order.contains(&f.id)
                        && !model.graph.blocked_ids.contains(&f.id)
                })
            {
                let mut fields = BTreeSet::new();
                if !collect(&f.ast, &mut fields) {
                    counts.clear();
                    break;
                }
                for field in fields {
                    if !counts.contains_key(&field) && counts.len() == 64 {
                        return Self {
                            fields: BTreeSet::new(),
                            entries: vec![],
                        };
                    }
                    *counts.entry(field).or_default() += 1;
                }
            }
        }
        let mut repeated: Vec<_> = counts.into_iter().filter(|(_, n)| *n > 1).collect();
        repeated.sort_by(|(a, an), (b, bn)| bn.cmp(an).then_with(|| a.cmp(b)));
        Self {
            fields: repeated.into_iter().take(2).map(|(f, _)| f).collect(),
            entries: vec![],
        }
    }
    pub(super) fn eligible(&self, field: &str) -> bool {
        self.fields.contains(field)
    }
    pub(super) fn get(&self, field: &str, scope: &CalculationScope) -> Option<(WireValue, bool)> {
        self.entries
            .iter()
            .find(|e| e.field == field && e.scope.exact_eq(scope))
            .map(|e| (e.value.clone(), e.has_column))
    }
    pub(super) fn make_room(&mut self) {
        if self.entries.len() == 2 {
            self.entries.remove(0);
        }
    }
    pub(super) fn remember(
        &mut self,
        field: &str,
        at: &CalculationScope,
        value: &WireValue,
        metadata: FormulaMetadata,
    ) {
        let FormulaMetadata {
            source_columns,
            mut scopes,
            value_kind,
            format,
            statement_record_ids,
        } = metadata;
        if value_kind.is_some()
            || format.is_some()
            || !statement_record_ids.is_empty()
            || scopes.len() != 1
            || !scopes[0].exact_eq(at)
            || source_columns.len() > 1
            || source_columns.iter().any(|c| c.id != field)
        {
            return;
        }
        self.entries.push(Entry {
            field: field.into(),
            scope: scopes.pop().unwrap(),
            value: value.clone(),
            has_column: !source_columns.is_empty(),
        });
    }
}
fn collect(ast: &FormulaAst, fields: &mut BTreeSet<String>) -> bool {
    match ast {
        FormulaAst::Call { function, args } => {
            if *function == FormulaFunction::Sum && args.len() == 1 {
                if let FormulaAst::Reference {
                    target: ReferenceTarget::Field,
                    id,
                } = &args[0]
                {
                    if id.len() <= 256 {
                        fields.insert(id.clone());
                    }
                    if fields.len() > 64 {
                        return false;
                    }
                }
            }
            args.iter().all(|a| collect(a, fields))
        }
        FormulaAst::Unary { operand, .. } => collect(operand, fields),
        FormulaAst::Binary { left, right, .. } => collect(left, fields) && collect(right, fields),
        FormulaAst::Member { value, .. } => collect(value, fields),
        _ => true,
    }
}
/// Bound retained keys and leave fiscal/page/declared/field-qualified scopes on
/// the original path. Exhaustive destructuring forces a decision for new fields.
pub(super) fn bounded_scope(scope: &CalculationScope) -> bool {
    let CalculationScope {
        source_record_ids,
        category_constraints,
        context_slices,
        page,
        requested_fiscal_scope,
        field_constraints,
        temporal_context,
        declared_members,
    } = scope;
    if source_record_ids.len() > 512
        || page.is_some()
        || requested_fiscal_scope.is_some()
        || !field_constraints.is_empty()
        || !declared_members.is_empty()
        || *temporal_context != TemporalContext::default()
        || context_slices.as_ref().is_some_and(|s| s.len() > 16)
    {
        return false;
    }
    let mut bytes = 0usize;
    let mut entries = 0usize;
    for id in source_record_ids {
        bytes = bytes.saturating_add(id.len());
        if bytes > 16_384 {
            return false;
        }
    }
    for constraints in std::iter::once(category_constraints)
        .chain(context_slices.iter().flatten().map(|s| &s.categories))
    {
        for (k, v) in constraints.iter() {
            entries += 1;
            bytes = bytes.saturating_add(k.len()).saturating_add(v.len());
            if entries > 64 || bytes > 16_384 {
                return false;
            }
        }
    }
    entries <= 64
        && bytes <= 16_384
        && context_slices
            .iter()
            .flatten()
            .all(|s| s.company_ids.is_none())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scope_limits_and_two_entry_eviction_preserve_context_separation() {
        let model_fields = BTreeSet::from(["x".into(), "y".into(), "z".into()]);
        let mut cache = SharedSums {
            fields: model_fields,
            entries: vec![],
        };
        let scope = CalculationScope {
            source_record_ids: BTreeSet::from(["a".into()]),
            ..Default::default()
        };
        assert!(bounded_scope(&scope));
        for field in ["x", "y", "z"] {
            cache.make_room();
            cache.remember(
                field,
                &scope,
                &WireValue::F64(WireNumber::Finite(1.)),
                FormulaMetadata {
                    scopes: vec![scope.clone()],
                    ..Default::default()
                },
            );
        }
        assert_eq!(cache.entries.len(), 2);
        assert!(cache.get("x", &scope).is_none());
        assert!(cache.get("y", &scope).is_some());
        let mut other = scope.clone();
        other.source_record_ids = BTreeSet::from(["b".into()]);
        assert!(cache.get("y", &other).is_none());
        other = scope.clone();
        other
            .category_constraints
            .insert("cat".into(), "member".into());
        assert!(cache.get("y", &other).is_none());
        other = scope.clone();
        other.source_record_ids = (0..513).map(|i| i.to_string()).collect();
        assert!(!bounded_scope(&other));
        other = scope.clone();
        other.source_record_ids = BTreeSet::from(["x".repeat(16_385)]);
        assert!(!bounded_scope(&other));
        other = scope.clone();
        other.temporal_context.date_field_id = Some("date".into());
        assert!(!bounded_scope(&other));
        other = scope.clone();
        other
            .field_constraints
            .insert("x".into(), vec![WireValue::Null]);
        assert!(!bounded_scope(&other));
    }
}
