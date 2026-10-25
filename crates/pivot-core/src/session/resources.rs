// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Opt-in conservative structural accounting, distinct from allocator/process memory.
use super::*;
use std::mem::size_of;
/// Owned heap only: a container accounts its inline elements once, then visits their heaps.
pub(crate) trait HeapBytes {
    fn heap_bytes(&self) -> usize;
}
pub(crate) fn estimated<T: HeapBytes>(v: &T) -> usize {
    size_of::<T>().saturating_add(v.heap_bytes())
}
macro_rules! plain { ($($t:ty),*) => {$(impl HeapBytes for $t {fn heap_bytes(&self)->usize{0}})*}; }
plain!(bool, u8, u16, u32, u64, usize, i32, i64, f64);
pub(crate) use plain;
impl HeapBytes for String {
    fn heap_bytes(&self) -> usize {
        self.capacity().saturating_add(32)
    }
}
impl<T: HeapBytes> HeapBytes for Vec<T> {
    fn heap_bytes(&self) -> usize {
        self.iter().fold(
            self.capacity()
                .saturating_mul(size_of::<T>())
                .saturating_add(32),
            |n, v| n.saturating_add(v.heap_bytes()),
        )
    }
}
impl<T: HeapBytes> HeapBytes for Option<T> {
    fn heap_bytes(&self) -> usize {
        self.as_ref().map_or(0, HeapBytes::heap_bytes)
    }
}
impl<T: HeapBytes> HeapBytes for Box<T> {
    fn heap_bytes(&self) -> usize {
        estimated(self.as_ref()).saturating_add(32)
    }
}
impl<A: HeapBytes, B: HeapBytes> HeapBytes for (A, B) {
    fn heap_bytes(&self) -> usize {
        self.0.heap_bytes().saturating_add(self.1.heap_bytes())
    }
}
impl<A: HeapBytes, B: HeapBytes> HeapBytes for Result<A, B> {
    fn heap_bytes(&self) -> usize {
        match self {
            Ok(v) => v.heap_bytes(),
            Err(v) => v.heap_bytes(),
        }
    }
}
// Rust BTree nodes store up to 11 keys. Charge a complete sparse node per entry,
// 16 key/value slots plus 16 pointer/header slots, rounded upward; allocator overhead included.
impl<K: HeapBytes, V: HeapBytes> HeapBytes for BTreeMap<K, V> {
    fn heap_bytes(&self) -> usize {
        self.iter().fold(0usize, |n, (k, v)| {
            n.saturating_add(size_of::<(K, V)>().saturating_mul(16))
                .saturating_add(256)
                .saturating_add(k.heap_bytes())
                .saturating_add(v.heap_bytes())
        })
    }
}
impl<T: HeapBytes> HeapBytes for BTreeSet<T> {
    fn heap_bytes(&self) -> usize {
        self.iter().fold(0usize, |n, v| {
            n.saturating_add(size_of::<T>().saturating_mul(16))
                .saturating_add(256)
                .saturating_add(v.heap_bytes())
        })
    }
}
struct Count(usize);
impl std::io::Write for Count {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0 = self.0.saturating_add(b.len());
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
pub(super) fn wire_size<T: serde::Serialize>(v: &T) -> usize {
    let mut n = Count(0);
    if serde_json::to_writer(&mut n, v).is_err() {
        usize::MAX
    } else {
        n.0
    }
}
pub(super) fn check(limit: Option<usize>, bytes: usize, label: &str) -> Result<(), Diagnostic> {
    if limit.is_some_and(|max| bytes > max) {
        Err(problem("RESOURCE_LIMIT", label))
    } else {
        Ok(())
    }
}
fn member(ast: &FormulaAst) -> bool {
    match ast {
        FormulaAst::Member { .. } => true,
        FormulaAst::Unary { operand, .. } => member(operand),
        FormulaAst::Binary { left, right, .. } => member(left) || member(right),
        FormulaAst::Call { args, .. } => args.iter().any(member),
        _ => false,
    }
}
impl Session {
    pub(super) fn retained_bytes(&self) -> usize {
        let Self {
            locale,
            limits,
            input,
            view,
            transfers,
            batch_rows: _,
            disposed: _,
        } = self;
        size_of::<Self>()
            .saturating_add(locale.heap_bytes())
            .saturating_add(limits.heap_bytes())
            .saturating_add(input.heap_bytes())
            .saturating_add(view.heap_bytes())
            .saturating_add(transfers.heap_bytes())
    }
    /// Reserve complete old publication plus source/model copies, all row/scope/width
    /// combinations and stage scratch BEFORE calculation. Explicitly refuse profiles
    /// whose context expansion is not bounded here; no post hoc OOM safety claim.
    pub(super) fn reserve(
        &self,
        input: &SourceDataset,
        d: &ValidatedDefinition,
        extra: usize,
    ) -> Result<(), Diagnostic> {
        let Some(max) = self.limits.max_state_bytes else {
            return Ok(());
        };
        if matches!(
            d.definition.analytical,
            Some(AnalyticalDefinition::Statement(_))
        ) || d
            .definition
            .analytical
            .as_ref()
            .and_then(AnalyticalDefinition::table)
            .is_some_and(|m| m.formulas.iter().any(|f| member(&f.ast)))
        {
            return Err(problem(
                "RESOURCE_LIMIT",
                "State budget cannot bound Statement or MEMBER context expansion",
            ));
        }
        let n = input.rows.len().saturating_add(1);
        let (depth, values, categories, formulas) = if let Some(m) = d
            .definition
            .analytical
            .as_ref()
            .and_then(AnalyticalDefinition::table)
        {
            (
                m.layout.rows.len() + 1,
                m.layout.values.len(),
                m.categories.len(),
                m.formulas.len(),
            )
        } else if let Some(p) = &d.definition.table.pivot {
            (
                p.grouping.len() + 1,
                p.measures.as_ref().map_or(input.columns.len(), Vec::len),
                p.grouping.len() + p.split.len(),
                0,
            )
        } else {
            (1, input.columns.len(), 0, 0)
        };
        // 501 includes the group label above the immutable 500-pivot-column semantic cap.
        let width = if d
            .definition
            .analytical
            .as_ref()
            .and_then(AnalyticalDefinition::table)
            .is_some_and(|m| !m.layout.columns.is_empty())
            || d.definition
                .table
                .pivot
                .as_ref()
                .is_some_and(|p| !p.split.is_empty())
        {
            501usize.max(values)
        } else {
            input
                .columns
                .len()
                .saturating_add(values)
                .saturating_add(formulas)
                .saturating_add(1)
        };
        // One source-sized allowance per source-ID/scope/output/category/formula combination.
        // 18 stage slots cover evaluated/categorized/eligible rows, stored duplicates,
        // filtering/sort/projection, metadata/memo, and unfiltered chart-column preparation.
        // Two additional source-sized slots per complete scope/output combination
        // reserve retained aggregate results/typed scope keys and error/index scratch.
        let slots = [
            n,
            width,
            depth,
            categories.saturating_add(formulas).saturating_add(1),
            18,
        ]
        .into_iter()
        .try_fold(1usize, usize::checked_mul)
        .ok_or_else(|| problem("RESOURCE_LIMIT", "Workspace reservation overflow"))?;
        let workspace = estimated(input)
            .checked_add(estimated(d))
            .and_then(|b| b.checked_add(extra))
            .and_then(|b| b.checked_mul(slots))
            .ok_or_else(|| problem("RESOURCE_LIMIT", "Workspace reservation overflow"))?;
        check(
            Some(max),
            self.retained_bytes()
                .saturating_add(workspace)
                .saturating_add(self.host_reservation(input))
                .saturating_add(estimated(d).saturating_mul(12_288)),
            "Candidate workspace state budget exceeded",
        )
    }
    pub(super) fn host_reservation(&self, input: &SourceDataset) -> usize {
        // Main-thread source retained for reset; cloned transport, encoded wire and UTF16
        // conversion; 12 delivered + 12 in-flight UI blocks. Caller-retained chart/export
        // accumulation is outside session ownership and requires its own stream budget.
        let source = estimated(input)
            .saturating_mul(8)
            .saturating_add(wire_size(input).saturating_mul(8));
        let block = self
            .limits
            .max_cached_block_bytes
            .unwrap_or_else(|| estimated(input).saturating_mul(4));
        // Combined scalar/raw Rust cache 4096, host scalar + recipe 8192 entries.
        // Each key can encode two full source/model compound values, plus sparse map nodes.
        source
            .saturating_add(block.saturating_mul(24))
            .saturating_add(
                estimated(input)
                    .saturating_add(self.view.as_ref().map_or(0, |v| estimated(&v.saved)))
                    .saturating_add(512)
                    .saturating_mul(12_288),
            )
    }
    pub(super) fn envelope_wire_bytes(&self, q: &CoreRequest) -> usize {
        let Some(v) = &self.view else { return 512 };
        let mut bytes = wire_size(&(&q.request_id, &q.revision, &v.completeness, &v.diagnostics))
            .saturating_add(512);
        if let Some((_, i)) = &self.input {
            bytes = bytes.saturating_add(wire_size(&i.model_warnings));
        }
        if let Some(a) = &v.analytical {
            for w in &a.warnings {
                bytes = bytes
                    .saturating_add(wire_size(&(
                        &w.code,
                        &w.message,
                        &w.category_id,
                        &v.revision,
                    )))
                    .saturating_add(128);
            }
        }
        bytes
    }
    pub(super) fn envelope_state_bytes(&self) -> usize {
        self.view
            .as_ref()
            .map_or(0, |v| {
                estimated(&v.completeness).saturating_add(estimated(&v.diagnostics))
            })
            .saturating_add(
                self.input
                    .as_ref()
                    .map_or(0, |(_, i)| estimated(&i.model_warnings)),
            )
    }
    pub(super) fn check_candidate(&self, v: &StoredView) -> Result<(), Diagnostic> {
        if self.limits.cache_bytes.is_some() {
            check(
                self.limits.cache_bytes,
                estimated(v),
                "Retained result state budget exceeded",
            )?;
        }
        check(
            self.limits.max_pivot_columns,
            v.columns.len(),
            "Output column budget exceeded",
        )?;
        check(
            self.limits.max_pivot_columns,
            v.chart_columns.as_ref().map_or(0, Vec::len),
            "Chart schema column budget exceeded",
        )?;
        if let Some((_, input)) = &self.input {
            if self.limits.max_state_bytes.is_none() {
                return Ok(());
            }
            check(
                self.limits.max_state_bytes,
                self.retained_bytes()
                    .saturating_add(estimated(v))
                    .saturating_add(self.host_reservation(input))
                    .saturating_add(estimated(&v.saved).saturating_mul(12_288)),
                "Retained candidate state budget exceeded",
            )?;
        }
        Ok(())
    }
}

pub(super) fn bounded_rows<'a>(
    rows: impl Iterator<Item = &'a DatasetRow>,
) -> (usize, Vec<&'a DatasetRow>) {
    let refs = rows.collect::<Vec<_>>();
    let size = refs.iter().fold(0usize, |n, row| {
        n.saturating_add(estimated(*row).saturating_mul(4))
    });
    (size, refs)
}
