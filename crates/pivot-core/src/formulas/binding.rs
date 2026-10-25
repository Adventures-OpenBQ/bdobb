// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::syntax::from_bound;
use super::*;
use std::collections::BTreeSet;
struct Binder<'a> {
    symbols: &'a ModelSymbols,
    diagnostics: Vec<FormulaDiagnostic>,
    dependencies: Vec<FormulaDependency>,
}
impl Binder<'_> {
    fn add(&mut self, kind: &str, id: &str, category: Option<&str>) {
        let d = FormulaDependency {
            kind: kind.into(),
            id: id.into(),
            category_id: category.map(str::to_owned),
        };
        if !self.dependencies.contains(&d) {
            self.dependencies.push(d);
        }
    }
    fn issue(&mut self, code: &str, message: &str, ids: Vec<String>) {
        let mut d = FormulaDiagnostic::new(code, message);
        d.dependency_ids = ids;
        self.diagnostics.push(d);
    }
    fn unique(
        &mut self,
        candidates: &[(ReferenceTarget, String)],
        label: &str,
    ) -> Option<(ReferenceTarget, String)> {
        match candidates {
            [one] => Some(one.clone()),
            [] => {
                self.issue(
                    "missing-reference",
                    &format!("Missing reference: {label}."),
                    vec![label.into()],
                );
                None
            }
            _ => {
                let mut d = FormulaDiagnostic::new(
                    "ambiguous-reference",
                    &format!("Ambiguous reference: {label}. Choose a stable definition."),
                );
                d.candidate_ids = candidates.iter().map(|(_, id)| id.clone()).collect();
                self.diagnostics.push(d);
                None
            }
        }
    }
    fn input(&mut self, id: &str) {
        let candidates = self
            .symbols
            .fields
            .iter()
            .filter(|f| f.id == id)
            .map(|f| (ReferenceTarget::Field, f.id.clone()))
            .chain(
                self.symbols
                    .formulas
                    .iter()
                    .filter(|f| f.id == id)
                    .map(|f| (ReferenceTarget::Formula, f.id.clone())),
            )
            .collect::<Vec<_>>();
        if let Some((target, id)) = self.unique(&candidates, id) {
            if target == ReferenceTarget::Formula {
                self.add("formula", &id, None);
                if self
                    .symbols
                    .formulas
                    .iter()
                    .find(|f| f.id == id)
                    .is_some_and(|f| f.scope != FormulaScope::Source)
                {
                    self.issue(
                        "scope",
                        "Category and measure inputs must be source fields or source formulas.",
                        vec![id],
                    );
                }
            } else {
                self.add("field", &id, None);
            }
        }
    }
    fn reference(&mut self, target: ReferenceTarget, id: &str, scope: FormulaScope) -> FormulaAst {
        self.add(
            match target {
                ReferenceTarget::Field => "field",
                ReferenceTarget::Formula => "formula",
                ReferenceTarget::Measure => "measure",
            },
            id,
            None,
        );
        let matches: Vec<_> = match target {
            ReferenceTarget::Field => self
                .symbols
                .fields
                .iter()
                .filter(|f| f.id == id)
                .map(|f| (target, f.id.clone()))
                .collect(),
            ReferenceTarget::Formula => self
                .symbols
                .formulas
                .iter()
                .filter(|f| f.id == id)
                .map(|f| (target, f.id.clone()))
                .collect(),
            ReferenceTarget::Measure => self
                .symbols
                .measures
                .iter()
                .filter(|m| m.value.id == id)
                .map(|m| (target, m.value.id.clone()))
                .collect(),
        };
        if self.unique(&matches, id).is_some() {
            match target {
                ReferenceTarget::Field => {
                    if scope == FormulaScope::Aggregate {
                        let name = &self
                            .symbols
                            .fields
                            .iter()
                            .find(|f| f.id == id)
                            .unwrap()
                            .name;
                        self.issue(
                            "missing-aggregation",
                            &format!("Choose an aggregation for {name}."),
                            vec![id.into()],
                        );
                    }
                }
                ReferenceTarget::Formula => {
                    let f = self.symbols.formulas.iter().find(|f| f.id == id).unwrap();
                    if f.scope == FormulaScope::Aggregate && scope == FormulaScope::Source {
                        self.issue(
                            "scope",
                            "Source expressions cannot depend on aggregate formulas.",
                            vec![id.into()],
                        );
                    } else if f.scope == FormulaScope::Source && scope == FormulaScope::Aggregate {
                        self.issue(
                            "missing-aggregation",
                            &format!("Choose an aggregation for {}.", f.name),
                            vec![id.into()],
                        );
                    }
                }
                ReferenceTarget::Measure => {
                    let m = self
                        .symbols
                        .measures
                        .iter()
                        .find(|m| m.value.id == id)
                        .unwrap();
                    if scope == FormulaScope::Source {
                        self.issue(
                            "scope",
                            "Source expressions cannot depend on aggregate measure instances.",
                            vec![id.into()],
                        );
                    }
                    if m.value.aggregation.is_none() {
                        self.issue(
                            "missing-aggregation",
                            &format!("Choose an aggregation for {}.", m.name),
                            vec![id.into()],
                        );
                    }
                    self.input(&m.value.source_field_id);
                }
            }
        } else if target == ReferenceTarget::Measure && scope == FormulaScope::Source {
            self.issue(
                "scope",
                "Source expressions cannot depend on aggregate measure instances.",
                vec![id.into()],
            );
        }
        FormulaAst::Reference {
            target,
            id: id.into(),
        }
    }
    fn visit(&mut self, ast: &SyntaxAst, scope: FormulaScope) -> Option<FormulaAst> {
        match ast {
            SyntaxAst::Literal { value } => Some(FormulaAst::Literal {
                value: value.clone(),
            }),
            SyntaxAst::Reference { target, id } => Some(self.reference(*target, id, scope)),
            SyntaxAst::Name { name } => {
                let fields = self
                    .symbols
                    .fields
                    .iter()
                    .filter(|f| f.name == *name)
                    .map(|f| (ReferenceTarget::Field, f.id.clone()));
                let formulas = self.symbols.formulas.iter().filter(|f| f.name == *name);
                let measures = self
                    .symbols
                    .measures
                    .iter()
                    .filter(|m| m.name == *name || m.aliases.contains(name))
                    .collect::<Vec<_>>();
                let aggregate = measures
                    .iter()
                    .map(|m| (ReferenceTarget::Measure, m.value.id.clone()))
                    .chain(
                        formulas
                            .clone()
                            .filter(|f| f.scope == FormulaScope::Aggregate)
                            .map(|f| (ReferenceTarget::Formula, f.id.clone())),
                    )
                    .collect::<Vec<_>>();
                let candidates = if scope == FormulaScope::Aggregate && !aggregate.is_empty() {
                    aggregate
                } else {
                    fields
                        .chain(formulas.map(|f| (ReferenceTarget::Formula, f.id.clone())))
                        .collect()
                };
                if scope == FormulaScope::Aggregate
                    && candidates.len() > 1
                    && candidates
                        .iter()
                        .all(|(t, _)| *t == ReferenceTarget::Measure)
                    && measures
                        .iter()
                        .map(|m| &m.value.source_field_id)
                        .collect::<BTreeSet<_>>()
                        .len()
                        == 1
                {
                    let token = syntax::ambiguity_operand(name);
                    let mut d=FormulaDiagnostic::new("ambiguous-reference",&format!("{name} has more than one measure; use an explicit function such as SUM({token})"));
                    d.candidate_ids = candidates.iter().map(|(_, id)| id.clone()).collect();
                    self.diagnostics.push(d);
                    None
                } else {
                    self.unique(&candidates, name)
                        .map(|(target, id)| self.reference(target, &id, scope))
                }
            }
            SyntaxAst::Unary { operator, operand } => {
                self.visit(operand, scope).map(|operand| FormulaAst::Unary {
                    operator: *operator,
                    operand: Box::new(operand),
                })
            }
            SyntaxAst::Binary {
                operator,
                left,
                right,
            } => {
                let left = self.visit(left, scope);
                let right = self.visit(right, scope);
                left.zip(right).map(|(left, right)| FormulaAst::Binary {
                    operator: *operator,
                    left: Box::new(left),
                    right: Box::new(right),
                })
            }
            SyntaxAst::Call { function, args } => {
                let aggregate = *function != FormulaFunction::If;
                if aggregate && scope == FormulaScope::Source {
                    self.issue(
                        "scope",
                        "Aggregate calls are allowed only at aggregate scope.",
                        vec![],
                    );
                }
                let args = args
                    .iter()
                    .map(|a| {
                        self.visit(
                            a,
                            if aggregate {
                                FormulaScope::Source
                            } else {
                                scope
                            },
                        )
                    })
                    .collect::<Vec<_>>();
                let args = args.into_iter().collect::<Option<Vec<_>>>()?;
                Some(FormulaAst::Call {
                    function: *function,
                    args,
                })
            }
            SyntaxAst::Member { value, selectors } => {
                if scope == FormulaScope::Source {
                    self.issue(
                        "scope",
                        "Category member comparisons require aggregate scope.",
                        vec![],
                    );
                }
                let value = self.visit(value, scope);
                let mut bound = vec![];
                let mut seen = BTreeSet::new();
                for selector in selectors {
                    let (label, candidates) = match selector {
                        SyntaxSelector::Bound(s) => (
                            s.category_id.clone(),
                            self.symbols
                                .categories
                                .iter()
                                .filter(|c| c.value.id == s.category_id)
                                .collect::<Vec<_>>(),
                        ),
                        SyntaxSelector::Named { category_name, .. } => (
                            category_name.clone(),
                            self.symbols
                                .categories
                                .iter()
                                .filter(|c| c.value.name == *category_name)
                                .collect::<Vec<_>>(),
                        ),
                    };
                    let ids = candidates
                        .iter()
                        .map(|c| (ReferenceTarget::Field, c.value.id.clone()))
                        .collect::<Vec<_>>();
                    let Some((_, id)) = self.unique(&ids, &label) else {
                        if let SyntaxSelector::Bound(s) = selector {
                            self.add("category", &s.category_id, None);
                        }
                        continue;
                    };
                    let category = candidates[0];
                    self.add("category", &id, None);
                    self.input(&category.value.source_field_id);
                    if !seen.insert(id.clone()) {
                        self.issue(
                            "invalid-ast",
                            "Member selectors must name each category at most once.",
                            vec![id.clone()],
                        );
                    }
                    let member = match selector {
                        SyntaxSelector::Bound(s) => Some(s.member_key.clone()),
                        SyntaxSelector::Named { value, .. } => {
                            let mut matches = category
                                .members
                                .iter()
                                .filter(|(_, v)| v == value)
                                .collect::<Vec<_>>();
                            // A fiscal quarter is shown as FY2025-Q1 but stored as FY2025 Q1: either spelling binds.
                            if let (true, Transform::FQ, Literal::String(text)) =
                                (matches.is_empty(), category.value.transform, value)
                            {
                                if let Some(stored) = shown_fiscal_quarter(text) {
                                    let stored = Literal::String(stored);
                                    matches = category
                                        .members
                                        .iter()
                                        .filter(|(_, v)| *v == stored)
                                        .collect();
                                }
                            }
                            // A bucketed (Y/Q/M…) member is a string: an unquoted Year=2024 means "2024".
                            if let (true, Literal::Number(n)) = (matches.is_empty(), value) {
                                if category.value.transform != Transform::Native {
                                    let stored =
                                        Literal::String(crate::ordering::number_string(*n));
                                    matches = category
                                        .members
                                        .iter()
                                        .filter(|(_, v)| *v == stored)
                                        .collect();
                                }
                            }
                            match matches.as_slice() {
                                [(key, _)] => Some((*key).clone()),
                                [] => {
                                    self.issue(
                                        "missing-member",
                                        &format!("Missing member in {}.", category.value.name),
                                        vec![id.clone(), literal_label(value)],
                                    );
                                    None
                                }
                                _ => {
                                    let mut d = FormulaDiagnostic::new(
                                        "ambiguous-reference",
                                        &format!("Ambiguous member in {}.", category.value.name),
                                    );
                                    d.dependency_ids = vec![id.clone()];
                                    d.candidate_ids =
                                        matches.iter().map(|(key, _)| key.clone()).collect();
                                    self.diagnostics.push(d);
                                    None
                                }
                            }
                        }
                    };
                    if let Some(member_key) = member {
                        self.add("member", &member_key, Some(&id));
                        bound.push(MemberSelector {
                            category_id: id,
                            member_key,
                        });
                    }
                }
                value.map(|value| FormulaAst::Member {
                    value: Box::new(value),
                    selectors: bound,
                })
            }
        }
    }
}
fn literal_label(value: &Literal) -> String {
    match value {
        Literal::Number(n) => crate::ordering::number_string(*n),
        Literal::String(s) => s.clone(),
        Literal::Bool(b) => b.to_string(),
        Literal::Null => "null".into(),
    }
}
pub(crate) fn bind_ast(
    ast: &SyntaxAst,
    symbols: &ModelSymbols,
    scope: FormulaScope,
) -> FormulaBindResult {
    let mut binder = Binder {
        symbols,
        diagnostics: vec![],
        dependencies: vec![],
    };
    let bound = binder.visit(ast, scope);
    FormulaBindResult {
        ast: if binder.diagnostics.is_empty() {
            bound
        } else {
            None
        },
        diagnostics: binder.diagnostics,
        dependencies: binder.dependencies,
        resolved_operators: vec![],
    }
}
// Recover scoped token bindings and member identities from the committed AST shape.
fn remember(
    s: &SyntaxAst,
    b: &FormulaAst,
    scope: FormulaScope,
    bindings: &mut BTreeMap<(u8, String), Option<FormulaAst>>,
    members: &mut BTreeMap<String, Option<MemberSelector>>,
) {
    match (s, b) {
        (SyntaxAst::Name { name }, FormulaAst::Reference { .. }) => {
            let key = (scope_key(scope), name.clone());
            if let Some(old) = bindings.get(&key) {
                if old.as_ref().is_some_and(|old| !same_reference(old, b)) {
                    bindings.insert(key, None);
                }
            } else {
                bindings.insert(key, Some(b.clone()));
            }
        }
        (SyntaxAst::Unary { operand: s, .. }, FormulaAst::Unary { operand: b, .. }) => {
            remember(s, b, scope, bindings, members)
        }
        (
            SyntaxAst::Binary {
                left: sl,
                right: sr,
                ..
            },
            FormulaAst::Binary {
                left: bl,
                right: br,
                ..
            },
        ) => {
            remember(sl, bl, scope, bindings, members);
            remember(sr, br, scope, bindings, members);
        }
        (SyntaxAst::Call { function, args: s }, FormulaAst::Call { args: b, .. }) => {
            for (s, b) in s.iter().zip(b) {
                remember(
                    s,
                    b,
                    if *function == FormulaFunction::If {
                        scope
                    } else {
                        FormulaScope::Source
                    },
                    bindings,
                    members,
                );
            }
        }
        (
            SyntaxAst::Member {
                value: s,
                selectors: ss,
            },
            FormulaAst::Member {
                value: b,
                selectors: bs,
            },
        ) => {
            remember(s, b, scope, bindings, members);
            for (s, b) in ss.iter().zip(bs) {
                if let SyntaxSelector::Named {
                    category_name,
                    value,
                } = s
                {
                    let key = member_token(category_name, value);
                    if let Some(old) = members.get(&key) {
                        if old.as_ref().is_some_and(|old| {
                            old.category_id != b.category_id || old.member_key != b.member_key
                        }) {
                            members.insert(key, None);
                        }
                    } else {
                        members.insert(key, Some(b.clone()));
                    }
                }
            }
        }
        _ => (),
    }
}
fn member_token(name: &str, value: &Literal) -> String {
    serde_json::to_string(&(name, value)).unwrap()
}
fn same_reference(a: &FormulaAst, b: &FormulaAst) -> bool {
    matches!((a,b),(FormulaAst::Reference{target:at,id:ai},FormulaAst::Reference{target:bt,id:bi}) if at==bt&&ai==bi)
}
fn scope_key(scope: FormulaScope) -> u8 {
    if scope == FormulaScope::Source {
        0
    } else {
        1
    }
}
fn apply(
    ast: SyntaxAst,
    scope: FormulaScope,
    bindings: &BTreeMap<(u8, String), Option<FormulaAst>>,
    members: &BTreeMap<String, Option<MemberSelector>>,
) -> SyntaxAst {
    match ast {
        SyntaxAst::Name { name } => bindings
            .get(&(scope_key(scope), name.clone()))
            .and_then(Option::as_ref)
            .map(from_bound)
            .unwrap_or(SyntaxAst::Name { name }),
        SyntaxAst::Unary { operator, operand } => SyntaxAst::Unary {
            operator,
            operand: Box::new(apply(*operand, scope, bindings, members)),
        },
        SyntaxAst::Binary {
            operator,
            left,
            right,
        } => SyntaxAst::Binary {
            operator,
            left: Box::new(apply(*left, scope, bindings, members)),
            right: Box::new(apply(*right, scope, bindings, members)),
        },
        SyntaxAst::Call { function, args } => SyntaxAst::Call {
            function,
            args: args
                .into_iter()
                .map(|a| {
                    apply(
                        a,
                        if function == FormulaFunction::If {
                            scope
                        } else {
                            FormulaScope::Source
                        },
                        bindings,
                        members,
                    )
                })
                .collect(),
        },
        SyntaxAst::Member { value, selectors } => SyntaxAst::Member {
            value: Box::new(apply(*value, scope, bindings, members)),
            selectors: selectors
                .into_iter()
                .map(|s| match &s {
                    SyntaxSelector::Named {
                        category_name,
                        value,
                    } => members
                        .get(&member_token(category_name, value))
                        .and_then(Option::as_ref)
                        .cloned()
                        .map(SyntaxSelector::Bound)
                        .unwrap_or(s),
                    _ => s,
                })
                .collect(),
        },
        _ => ast,
    }
}
/// `FY2025-Q1` (the displayed fiscal-quarter label) as its stored member value `FY2025 Q1`.
fn shown_fiscal_quarter(text: &str) -> Option<String> {
    let (year, quarter) = text.strip_prefix("FY")?.split_once("-Q")?;
    (year.len() == 4
        && year.bytes().all(|b| b.is_ascii_digit())
        && matches!(quarter, "1" | "2" | "3" | "4"))
    .then(|| format!("FY{year} Q{quarter}"))
}
pub fn bind_formula(
    model: &CompiledModel,
    draft: &FormulaDraft,
    bindings: &[ScopedBinding],
) -> FormulaBindResult {
    let parsed = parse_formula(&draft.expression);
    let mut result = FormulaBindResult {
        ast: None,
        diagnostics: parsed.diagnostics,
        dependencies: vec![],
        resolved_operators: vec![],
    };
    let Some(parsed) = parsed.ast else {
        return result;
    };
    if draft.id.is_empty() || draft.name.is_empty() {
        result.diagnostics.push(FormulaDiagnostic::new(
            "invalid-ast",
            "Invalid plain formula definition; original entry retained.",
        ));
        return result;
    }
    let originals = model
        .graph
        .entries
        .iter()
        .filter(|e| e.value.as_ref().is_some_and(|f| f.id == draft.id))
        .collect::<Vec<_>>();
    if originals.len() > 1 {
        result.diagnostics.push(FormulaDiagnostic::new(
            "duplicate-id",
            "Formula ID is ambiguous.",
        ));
        return result;
    }
    let original = originals.first().and_then(|e| e.value.as_ref());
    let mut remembered = BTreeMap::new();
    let mut members = BTreeMap::new();
    if let Some(original) = original {
        if let Some(syntax) = parse_formula(&original.expression).ast {
            remember(
                &syntax,
                &original.ast,
                original.scope,
                &mut remembered,
                &mut members,
            );
        }
    }
    for binding in bindings {
        if !matches!(binding.reference, FormulaAst::Reference { .. }) {
            result.diagnostics.push(FormulaDiagnostic::new(
                "invalid-ast",
                "Scoped bindings require a bound reference.",
            ));
            continue;
        }
        remembered.insert(
            (scope_key(binding.scope), binding.name.clone()),
            Some(binding.reference.clone()),
        );
    }
    if !result.diagnostics.is_empty() {
        return result;
    }
    let syntax = if let Some(f) = original.filter(|f| f.expression == draft.expression) {
        from_bound(&f.ast)
    } else {
        apply(parsed, draft.scope, &remembered, &members)
    };
    let mut symbols = model.symbols.clone();
    symbols.formulas.retain(|f| f.id != draft.id);
    symbols.formulas.push(draft.clone());
    result = bind_ast(&syntax, &symbols, draft.scope);
    if let Some(ast) = &result.ast {
        if serde_json::to_vec(ast).map_or(true, |encoded| encoded.len() > 131072) {
            result.diagnostics.push(FormulaDiagnostic::new(
                "node-limit",
                "Bound formula exceeds the authoring AST budget.",
            ));
        }
        if let Err(d) = validate_ast(ast) {
            result.diagnostics.push(d);
        }
        let mut definitions = model
            .graph
            .entries
            .iter()
            .filter(|e| e.raw.id != draft.id)
            .map(|e| e.raw.clone())
            .collect::<Vec<_>>();
        definitions.push(Formula {
            id: draft.id.clone(),
            name: draft.name.clone(),
            scope: draft.scope,
            expression: draft.expression.clone(),
            ast: ast.clone(),
            format: draft.format.clone(),
        });
        let graph = super::graph::compile_graph(&definitions, &symbols);
        result.diagnostics.extend(
            graph
                .diagnostics
                .into_iter()
                .filter(|d| d.definition_id.as_deref() == Some(&draft.id)),
        );
        if chronological(ast) {
            let dates = model
                .categories
                .iter()
                .filter(|c| c.transform != Transform::Native || c.legacy_bucket.is_some())
                .map(|c| &c.source_field_id)
                .collect::<BTreeSet<_>>();
            let companies = model
                .categories
                .iter()
                .filter_map(|c| c.fiscal_binding.as_ref().map(|b| &b.company_field_id))
                .collect::<BTreeSet<_>>();
            if dates.len() != 1 || companies.len() > 1 {
                result.diagnostics.push(FormulaDiagnostic::new("scope","First and Last require one declared temporal category and an unambiguous company mapping."));
            }
        }
        if result.diagnostics.is_empty() {
            result.resolved_operators = operators(ast, model);
        } else {
            result.ast = None;
        }
    }
    result
}
fn chronological(ast: &FormulaAst) -> bool {
    match ast {
        FormulaAst::Call { function, args } => {
            matches!(function, FormulaFunction::First | FormulaFunction::Last)
                || args.iter().any(chronological)
        }
        FormulaAst::Unary { operand, .. } => chronological(operand),
        FormulaAst::Binary { left, right, .. } => chronological(left) || chronological(right),
        FormulaAst::Member { value, .. } => chronological(value),
        _ => false,
    }
}
fn operators(ast: &FormulaAst, model: &CompiledModel) -> Vec<Aggregation> {
    let mut result = vec![];
    let mut nodes = vec![ast];
    let mut seen = BTreeSet::new();
    while let Some(n) = nodes.pop() {
        match n {
            FormulaAst::Reference {
                target: ReferenceTarget::Measure,
                id,
            } => {
                if let Some(op) = model
                    .symbols
                    .measures
                    .iter()
                    .find(|m| m.value.id == *id)
                    .and_then(|m| m.value.aggregation)
                {
                    if !result.contains(&op) {
                        result.push(op);
                    }
                }
            }
            FormulaAst::Reference {
                target: ReferenceTarget::Formula,
                id,
            } => {
                if seen.insert(id) {
                    if let Some(f) = model
                        .graph
                        .entries
                        .iter()
                        .filter_map(|e| e.value.as_ref())
                        .find(|f| f.id == *id)
                    {
                        nodes.push(&f.ast);
                    }
                }
            }
            FormulaAst::Unary { operand, .. } => nodes.push(operand),
            FormulaAst::Binary { left, right, .. } => {
                nodes.push(left);
                nodes.push(right);
            }
            FormulaAst::Call { function, args } => {
                if let Some(op) = function_aggregation(*function) {
                    if !result.contains(&op) {
                        result.push(op);
                    }
                }
                nodes.extend(args);
            }
            FormulaAst::Member { value, .. } => nodes.push(value),
            _ => (),
        }
    }
    result
}

#[cfg(test)]
mod token_tests {
    #[test]
    fn canonical_ambiguity_tokens_and_unrepresentable_name_fallback() {
        for (name, token) in [
            ("a-b", "[a-b]"),
            ("true", "[true]"),
            ("Revenue", "Revenue"),
            ("a]b", "a]b"),
            ("a b]c", "[a b]c]"),
            ("a\u{a0}b]c", "a\u{a0}b]c"),
        ] {
            assert_eq!(super::syntax::ambiguity_operand(name), token);
        }
    }
}
