// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use std::collections::BTreeSet;
pub(super) fn hierarchy(groups: &[LogicalGroup]) -> BTreeMap<String, Vec<String>> {
    fn visit(g: &LogicalGroup, m: &mut BTreeMap<String, Vec<String>>) -> Vec<String> {
        let mut ids = vec![];
        for c in &g.children {
            ids.push(c.id.clone());
            ids.extend(visit(c, m));
        }
        m.insert(g.id.clone(), ids.clone());
        ids
    }
    let mut m = BTreeMap::new();
    for g in groups {
        visit(g, &mut m);
    }
    m
}
/// Borrow payloads throughout selection. Only delivery projection makes owned rows.
pub(super) fn presented<'a>(
    v: &'a StoredView,
    s: &'a SelectionSpec,
) -> Box<dyn Iterator<Item = &'a DatasetRow> + 'a> {
    match s {
        SelectionSpec::None => Box::new(v.eligible.iter()),
        SelectionSpec::AllMatching { excluded_ids } => {
            let mut excluded: BTreeSet<&str> = excluded_ids.iter().map(String::as_str).collect();
            for id in excluded_ids {
                if let Some(children) = v.hierarchy.get(id) {
                    excluded.extend(children.iter().map(String::as_str));
                }
            }
            Box::new(
                v.eligible
                    .iter()
                    .filter(move |r| !excluded.contains(r.id.as_str())),
            )
        }
        SelectionSpec::Explicit { ids } => {
            if v.groups.is_empty() {
                Box::new(v.eligible.iter().filter(move |r| ids.contains(&r.id)))
            } else {
                Box::new(SelectedGroups {
                    stack: vec![v.groups.iter()],
                    ids,
                })
            }
        }
    }
}
struct SelectedGroups<'a> {
    stack: Vec<std::slice::Iter<'a, LogicalGroup>>,
    ids: &'a [String],
}
impl<'a> Iterator for SelectedGroups<'a> {
    type Item = &'a DatasetRow;
    fn next(&mut self) -> Option<Self::Item> {
        loop {
            match self.stack.last_mut()?.next() {
                Some(group) if self.ids.contains(&group.id) => return Some(&group.rows[0]),
                Some(group) if !group.children.is_empty() => self.stack.push(group.children.iter()),
                Some(_) => {}
                None => {
                    self.stack.pop();
                }
            }
        }
    }
}
pub(super) fn summary(
    v: &StoredView,
    action: &SelectionAction,
    visible: &[String],
) -> Result<SelectionSummary, Diagnostic> {
    if visible.len() > 1200 {
        return Err(problem(
            "INVALID_REQUEST",
            "Selection visible IDs must be bounded",
        ));
    }
    let mut selectable = BTreeSet::new();
    fn visit(g: &LogicalGroup, s: &mut BTreeSet<String>) {
        s.insert(g.id.clone());
        for c in &g.children {
            visit(c, s)
        }
    }
    for g in &v.groups {
        visit(g, &mut selectable)
    }
    if v.groups.is_empty() {
        selectable.extend(v.eligible.iter().map(|r| r.id.clone()));
    }
    let mut s = v.selection.clone();
    match action {
        SelectionAction::All => {
            s = SelectionSpec::AllMatching {
                excluded_ids: vec![],
            }
        }
        SelectionAction::Clear => s = SelectionSpec::None,
        SelectionAction::Toggle { row_id } => {
            if !selectable.contains(row_id) {
                return Err(problem("INVALID_REQUEST", "Row is not selectable"));
            }
            let descendants = v.hierarchy.get(row_id).cloned().unwrap_or_default();
            match &s {
                SelectionSpec::AllMatching { excluded_ids } => {
                    let checked =
                        summary(v, &SelectionAction::Summary, std::slice::from_ref(row_id))?.rows
                            [0]
                        .checked;
                    let mut excluded = excluded_ids.clone();
                    let ancestors: Vec<_> = excluded
                        .iter()
                        .filter(|id| {
                            v.hierarchy
                                .get(*id)
                                .is_some_and(|children| children.contains(row_id))
                        })
                        .cloned()
                        .collect();
                    if !checked {
                        let mut branch = descendants.clone();
                        branch.push(row_id.clone());
                        for ancestor in ancestors {
                            excluded.retain(|id| id != &ancestor);
                            for d in v.hierarchy.get(&ancestor).into_iter().flatten() {
                                if !branch.contains(d)
                                    && !v.hierarchy.get(d).is_some_and(|c| c.contains(row_id))
                                    && !excluded.contains(d)
                                {
                                    excluded.push(d.clone());
                                }
                            }
                        }
                        excluded.retain(|id| !branch.contains(id));
                    } else {
                        for id in std::iter::once(row_id).chain(descendants.iter()) {
                            if !excluded.contains(id) {
                                excluded.push(id.clone());
                            }
                        }
                    }
                    s = SelectionSpec::AllMatching {
                        excluded_ids: excluded,
                    };
                }
                _ => {
                    let mut ids = if let SelectionSpec::Explicit { ids } = &s {
                        ids.clone()
                    } else {
                        vec![]
                    };
                    if ids.contains(row_id) {
                        ids.retain(|id| id != row_id)
                    } else {
                        ids.retain(|id| {
                            !descendants.contains(id)
                                && !v.hierarchy.get(id).is_some_and(|c| c.contains(row_id))
                        });
                        ids.push(row_id.clone());
                    }
                    s = SelectionSpec::Explicit { ids };
                }
            }
        }
        SelectionAction::Summary => {}
    }
    let selected: BTreeSet<_> = if matches!(s, SelectionSpec::None) {
        BTreeSet::new()
    } else {
        presented(v, &s).map(|r| r.id.clone()).collect()
    };
    let eligible: BTreeSet<_> = v.eligible.iter().map(|r| r.id.clone()).collect();
    let checked = !v.eligible.is_empty() && v.eligible.iter().all(|r| selected.contains(&r.id));
    let rows = visible
        .iter()
        .map(|id| {
            let can = selectable.contains(id);
            let descendants: Vec<_> = v
                .hierarchy
                .get(id)
                .into_iter()
                .flatten()
                .filter(|id| eligible.contains(*id))
                .collect();
            let n = descendants
                .iter()
                .filter(|id| selected.contains(**id))
                .count();
            let yes = can
                && (selected.contains(id)
                    || (matches!(s, SelectionSpec::AllMatching { .. })
                        && !descendants.is_empty()
                        && n == descendants.len()));
            SelectionRowState {
                row_id: id.clone(),
                selectable: can,
                checked: yes,
                indeterminate: can && !yes && n > 0,
            }
        })
        .collect();
    Ok(SelectionSummary {
        selection: s,
        selected_count: selected.len() as u64,
        eligible_count: v.eligible.len() as u64,
        checked,
        indeterminate: !checked && !selected.is_empty(),
        rows,
    })
}
pub(super) fn reconcile(
    v: &mut StoredView,
    reconcile: bool,
    previous: Option<&str>,
    absent: &[String],
) {
    fn namespace(id: &str) -> Option<String> {
        let a: serde_json::Value = serde_json::from_str(id).ok()?;
        let a = a.as_array()?;
        (a.len() == 3 && a[0] == "group")
            .then(|| a[1].as_str().map(str::to_owned))
            .flatten()
    }
    let original = match &v.selection {
        SelectionSpec::None => return,
        SelectionSpec::Explicit { ids } => ids,
        SelectionSpec::AllMatching { excluded_ids } => excluded_ids,
    };
    let mut ids = vec![];
    for id in original {
        if !ids.contains(id) {
            ids.push(id.clone())
        }
    }
    let count = ids.len();
    ids.retain(|id| {
        if v.identity_ids.contains(id) {
            return true;
        }
        if reconcile || absent.contains(id) {
            return false;
        }
        let ns = namespace(id);
        if let Some(current) = &v.namespace {
            ns.as_ref() == Some(current)
        } else {
            previous.is_none() || ns.as_deref() != previous
        }
    });
    if count > ids.len() {
        let mut d=problem("SELECTION_RECONCILED",&format!("{} selection identities removed because they are no longer available in this arrangement.",count-ids.len()));
        d.severity = Severity::Info;
        d.path = None;
        v.diagnostics.push(d);
    }
    v.selection = match &v.selection {
        SelectionSpec::Explicit { .. } => {
            if ids.is_empty() {
                SelectionSpec::None
            } else {
                let covered: BTreeSet<_> = ids
                    .iter()
                    .flat_map(|id| v.hierarchy.get(id).into_iter().flatten().cloned())
                    .collect();
                SelectionSpec::Explicit {
                    ids: ids.into_iter().filter(|id| !covered.contains(id)).collect(),
                }
            }
        }
        SelectionSpec::AllMatching { .. } => SelectionSpec::AllMatching { excluded_ids: ids },
        _ => SelectionSpec::None,
    };
}
