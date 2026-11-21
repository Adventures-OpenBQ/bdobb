// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::CategoryMemberResult;
/// Sorted per-row category map without the spare slots of a tree node.
#[derive(Clone, Debug, Default)]
pub struct RowCategoryMembers(Vec<(String, CategoryMemberResult)>);
impl RowCategoryMembers {
    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.0.iter().map(|(k, _)| k)
    }
    pub(super) fn from_entries(mut entries: Vec<(String, CategoryMemberResult)>) -> Self {
        // Stable sorting keeps equal keys in source order; the last value wins like BTreeMap::insert.
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        entries.dedup_by(|later, earlier| {
            if later.0 == earlier.0 {
                std::mem::swap(&mut later.1, &mut earlier.1);
                true
            } else {
                false
            }
        });
        Self(entries)
    }
    #[cfg(test)]
    fn with_capacity(capacity: usize) -> Self {
        Self(Vec::with_capacity(capacity))
    }
    pub fn get(&self, key: &str) -> Option<&CategoryMemberResult> {
        self.0
            .binary_search_by(|(k, _)| k.as_str().cmp(key))
            .ok()
            .map(|i| &self.0[i].1)
    }
    pub fn get_mut(&mut self, key: &str) -> Option<&mut CategoryMemberResult> {
        self.0
            .binary_search_by(|(k, _)| k.as_str().cmp(key))
            .ok()
            .map(|i| &mut self.0[i].1)
    }
    pub fn insert(
        &mut self,
        key: String,
        value: CategoryMemberResult,
    ) -> Option<CategoryMemberResult> {
        match self.0.binary_search_by(|(k, _)| k.cmp(&key)) {
            Ok(i) => Some(std::mem::replace(&mut self.0[i].1, value)),
            Err(i) => {
                self.0.insert(i, (key, value));
                None
            }
        }
    }
}
impl<'a> IntoIterator for &'a RowCategoryMembers {
    type Item = (&'a String, &'a CategoryMemberResult);
    type IntoIter = std::iter::Map<
        std::slice::Iter<'a, (String, CategoryMemberResult)>,
        fn(&'a (String, CategoryMemberResult)) -> Self::Item,
    >;
    fn into_iter(self) -> Self::IntoIter {
        self.0.iter().map(|(k, v)| (k, v))
    }
}
impl crate::session::resources::HeapBytes for RowCategoryMembers {
    fn heap_bytes(&self) -> usize {
        crate::session::resources::HeapBytes::heap_bytes(&self.0)
    }
}

impl std::ops::Index<&str> for RowCategoryMembers {
    type Output = CategoryMemberResult;
    fn index(&self, key: &str) -> &Self::Output {
        self.get(key).expect("no entry found for key")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        formulas::ModelError,
        session::resources::{estimated, HeapBytes},
    };
    use std::collections::BTreeMap;
    fn error(value: usize) -> CategoryMemberResult {
        Err(ModelError {
            record_ids_present: true,
            dependency_ids_present: true,
            code: "invalid-date".into(),
            message: format!("error-{value}"),
            definition_id: value.to_string(),
            record_ids: vec![format!("row-{value}")],
            dependency_ids: vec!["date".into()],
        })
    }
    #[test]
    fn matches_tree_order_replacement_lookup_and_mutation() {
        let keys = ["z", "a", "", "01", "1", "é", "\u{e000}", "😀", "a"];
        for shift in 0..keys.len() {
            let mut actual = RowCategoryMembers::with_capacity(keys.len());
            let mut expected = BTreeMap::new();
            for i in 0..keys.len() {
                let key = keys[(i + shift) % keys.len()].to_string();
                assert_eq!(
                    actual.insert(key.clone(), error(i)).map(|r| r.unwrap_err()),
                    expected.insert(key, error(i)).map(|r| r.unwrap_err())
                );
            }
            assert_eq!(
                actual.keys().collect::<Vec<_>>(),
                expected.keys().collect::<Vec<_>>()
            );
            for key in keys {
                assert_eq!(
                    actual.get(key).unwrap().as_ref().unwrap_err(),
                    expected.get(key).unwrap().as_ref().unwrap_err()
                );
            }
            assert!(actual.get("absent").is_none());
            assert!(actual.get_mut("absent").is_none());
            *actual.get_mut("a").unwrap() = error(123);
            expected.insert("a".into(), error(123));
            assert_eq!(
                (&actual)
                    .into_iter()
                    .map(|(k, v)| (k, v.as_ref().unwrap_err()))
                    .collect::<Vec<_>>(),
                expected
                    .iter()
                    .map(|(k, v)| (k, v.as_ref().unwrap_err()))
                    .collect::<Vec<_>>()
            );
            let mut cloned = actual.clone();
            *cloned.get_mut("a").unwrap() = error(456);
            assert_ne!(
                cloned["a"].as_ref().unwrap_err(),
                actual["a"].as_ref().unwrap_err()
            );
        }
    }
    #[test]
    fn batch_construction_preserves_last_value_and_sorted_key_order() {
        let keys = ["z", "a", "😀", "a", "", "z", "é"];
        let entries = keys
            .iter()
            .enumerate()
            .map(|(i, k)| ((*k).to_string(), error(i)))
            .collect::<Vec<_>>();
        let tree = entries.iter().cloned().collect::<BTreeMap<_, _>>();
        let actual = RowCategoryMembers::from_entries(entries);
        assert_eq!(
            (&actual)
                .into_iter()
                .map(|(k, v)| (k, v.as_ref().unwrap_err()))
                .collect::<Vec<_>>(),
            tree.iter()
                .map(|(k, v)| (k, v.as_ref().unwrap_err()))
                .collect::<Vec<_>>()
        );
    }
    #[test]
    fn small_map_uses_less_accounted_storage_than_sparse_tree_nodes() {
        let mut actual = RowCategoryMembers::with_capacity(3);
        let mut tree = BTreeMap::new();
        for i in 0..3 {
            actual.insert(i.to_string(), error(i));
            tree.insert(i.to_string(), error(i));
        }
        assert!(estimated(&actual) < estimated(&tree));
    }
    #[test]
    fn accounting_includes_reserved_slots_and_nested_error_payloads() {
        let mut actual = RowCategoryMembers::with_capacity(16);
        let reserved = actual.heap_bytes();
        let mut value = error(0).unwrap_err();
        value.message = "x".repeat(4096);
        actual.insert("a".into(), Err(value));
        assert!(actual.heap_bytes() >= reserved + 4096);
    }
}
