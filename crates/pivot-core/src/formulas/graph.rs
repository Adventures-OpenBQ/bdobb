// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use std::collections::BTreeSet;
type Key = (String, String);
fn key(kind: &str, id: &str) -> Key {
    (kind.into(), id.into())
}
fn add_edge(edges: &mut BTreeMap<Key, Vec<Key>>, from: &Key, to: Key) {
    let entries = edges.entry(from.clone()).or_default();
    if !entries.contains(&to) {
        entries.push(to);
    }
}
fn walk(ast: &FormulaAst, from: &Key, edges: &mut BTreeMap<Key, Vec<Key>>) {
    match ast {
        FormulaAst::Reference { target, id } => match target {
            ReferenceTarget::Formula => add_edge(edges, from, key("formula", id)),
            ReferenceTarget::Measure => add_edge(edges, from, key("measure", id)),
            _ => (),
        },
        FormulaAst::Unary { operand, .. } => walk(operand, from, edges),
        FormulaAst::Binary { left, right, .. } => {
            walk(left, from, edges);
            walk(right, from, edges);
        }
        FormulaAst::Call { args, .. } => {
            for a in args {
                walk(a, from, edges)
            }
        }
        FormulaAst::Member { value, selectors } => {
            walk(value, from, edges);
            for s in selectors {
                add_edge(edges, from, key("category", &s.category_id));
            }
        }
        _ => (),
    }
}
fn issue(graph: &mut FormulaGraph, index: usize, mut d: FormulaDiagnostic) {
    d.definition_id = Some(graph.entries[index].raw.id.clone());
    graph.entries[index].diagnostics.push(d.clone());
    graph.diagnostics.push(d);
}
pub(crate) fn compile_graph(formulas: &[Formula], symbols: &ModelSymbols) -> FormulaGraph {
    let mut graph = FormulaGraph::default();
    if formulas.len() > 50000 {
        graph.diagnostics.push(FormulaDiagnostic::new(
            "invalid-ast",
            "Expected a bounded dense formula definition array (at most 50,000 entries).",
        ));
        return graph;
    }
    let mut by_id: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut ids = vec![];
    for f in formulas {
        let index = graph.entries.len();
        graph.entries.push(GraphEntry {
            raw: f.clone(),
            value: None,
            diagnostics: vec![],
        });
        if !by_id.contains_key(&f.id) {
            ids.push(f.id.clone());
        }
        by_id.entry(f.id.clone()).or_default().push(index);
        let checked = if f.id.is_empty() || f.name.is_empty() {
            Err(FormulaDiagnostic::new(
                "invalid-ast",
                "Invalid plain formula definition; original entry retained.",
            ))
        } else if f.expression.len() > 16384
            || f.id.len() + f.name.len() + f.format.as_ref().map_or(0, String::len) > 16384
        {
            Err(FormulaDiagnostic::new(
                "expression-limit",
                "Formula exceeds the 16 KiB UTF-8 expression/metadata limit.",
            ))
        } else {
            validate_ast(&f.ast)
        };
        match checked {
            Err(d) => issue(&mut graph, index, d),
            Ok(()) => graph.entries[index].value = Some(f.clone()),
        }
    }
    for id in &ids {
        let entries = &by_id[id];
        if entries.len() > 1 {
            for &index in entries {
                issue(
                    &mut graph,
                    index,
                    FormulaDiagnostic::new("duplicate-id", "Formula ID is ambiguous."),
                );
                graph.entries[index].value = None;
            }
        }
    }
    // Both callers pass symbols whose formulas mirror `formulas`.
    let context = symbols;
    let mut nodes: BTreeMap<Key, GraphNode> = BTreeMap::new();
    let mut node_order = vec![];
    let mut edges: BTreeMap<Key, Vec<Key>> = BTreeMap::new();
    for f in formulas {
        let k = key("formula", &f.id);
        if !nodes.contains_key(&k) {
            node_order.push(k.clone());
        }
        nodes.insert(
            k.clone(),
            GraphNode {
                kind: "formula".into(),
                id: f.id.clone(),
                name: f.name.clone(),
            },
        );
        edges.entry(k).or_default();
    }
    for (kind, id, name, input) in context
        .measures
        .iter()
        .map(|m| ("measure", &m.value.id, &m.name, &m.value.source_field_id))
        .chain(context.categories.iter().map(|c| {
            (
                "category",
                &c.value.id,
                &c.value.name,
                &c.value.source_field_id,
            )
        }))
    {
        let k = key(kind, id);
        if !nodes.contains_key(&k) {
            node_order.push(k.clone());
        }
        nodes.insert(
            k.clone(),
            GraphNode {
                kind: kind.into(),
                id: id.clone(),
                name: name.clone(),
            },
        );
        edges.entry(k.clone()).or_default();
        if by_id.contains_key(input) {
            add_edge(&mut edges, &k, key("formula", input));
        }
    }
    let mut blocked = BTreeSet::new();
    let mut blocked_order = vec![];
    for index in 0..graph.entries.len() {
        let f = graph.entries[index].value.clone();
        let from = key("formula", &graph.entries[index].raw.id);
        if let Some(f) = f {
            if f.scope == FormulaScope::Source
                && context.fields.iter().any(|field| field.id == f.id)
            {
                let mut d = FormulaDiagnostic::new(
                    "ambiguous-reference",
                    "A source formula output cannot overwrite a raw input field with the same ID.",
                );
                d.dependency_ids = vec![f.id.clone()];
                issue(&mut graph, index, d);
            }
            for d in binding::bind_ast(&syntax::from_bound(&f.ast), context, f.scope).diagnostics {
                issue(&mut graph, index, d);
            }
            walk(&f.ast, &from, &mut edges);
        }
        if !graph.entries[index].diagnostics.is_empty() && blocked.insert(from.clone()) {
            blocked_order.push(from);
        }
    }
    let mut state: BTreeMap<Key, u8> = BTreeMap::new();
    let mut postorder = vec![];
    // Iterative graph traversal bounds stack usage even for 50,000-formula chains.
    for start in &node_order {
        if state.contains_key(start) {
            continue;
        }
        let mut stack = vec![(start.clone(), 0usize)];
        state.insert(start.clone(), 1);
        while let Some((current, index)) = stack.last_mut() {
            let current = current.clone();
            let next = edges[&current].get(*index).cloned();
            *index += 1;
            let Some(next) = next else {
                state.insert(current.clone(), 2);
                postorder.push(current);
                stack.pop();
                continue;
            };
            if !nodes.contains_key(&next) {
                continue;
            }
            match state.get(&next) {
                Some(1) => {
                    let begin = stack.iter().position(|(k, _)| k == &next).unwrap();
                    let path = stack[begin..]
                        .iter()
                        .map(|(k, _)| nodes[k].clone())
                        .chain(std::iter::once(nodes[&next].clone()))
                        .collect::<Vec<_>>();
                    let ids = path.iter().map(|n| n.id.clone()).collect::<Vec<_>>();
                    let names = path.iter().map(|n| n.name.clone()).collect::<Vec<_>>();
                    for node in &path {
                        let k = key(&node.kind, &node.id);
                        if blocked.insert(k.clone()) {
                            blocked_order.push(k);
                        }
                        if node.kind == "formula" {
                            for &i in &by_id[&node.id] {
                                if !graph.entries[i]
                                    .diagnostics
                                    .iter()
                                    .any(|d| d.code == "cycle" && d.dependency_ids == ids)
                                {
                                    let mut d = FormulaDiagnostic::new(
                                        "cycle",
                                        &format!("Circular reference: {}.", names.join(" → ")),
                                    );
                                    d.dependency_ids = ids.clone();
                                    issue(&mut graph, i, d);
                                }
                            }
                        }
                    }
                }
                None => {
                    state.insert(next.clone(), 1);
                    stack.push((next, 0));
                }
                _ => (),
            }
        }
    }
    let mut reverse: BTreeMap<Key, Vec<Key>> = BTreeMap::new();
    for from in &node_order {
        for to in &edges[from] {
            let refs = reverse.entry(to.clone()).or_default();
            if !refs.contains(from) {
                refs.push(from.clone());
            }
        }
    }
    let mut index = 0;
    while index < blocked_order.len() {
        let dependency = blocked_order[index].clone();
        index += 1;
        for dependent in reverse.get(&dependency).into_iter().flatten() {
            if !blocked.insert(dependent.clone()) {
                continue;
            }
            blocked_order.push(dependent.clone());
            if dependent.0 == "formula" {
                for &i in &by_id[&dependent.1] {
                    let mut d = FormulaDiagnostic::new(
                        "blocked-dependency",
                        "A required definition is invalid or circular.",
                    );
                    d.dependency_ids = vec![dependency.1.clone()];
                    issue(&mut graph, i, d);
                }
            }
        }
    }
    graph.blocked_ids = ids
        .into_iter()
        .filter(|id| blocked.contains(&key("formula", id)))
        .collect();
    graph.order = postorder
        .into_iter()
        .filter(|k| k.0 == "formula" && !blocked.contains(k))
        .map(|k| k.1)
        .collect();
    graph
}
