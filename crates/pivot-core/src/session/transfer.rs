#![allow(clippy::result_large_err)]
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
impl Session {
    pub(super) fn next(
        &mut self,
        q: &CoreRequest,
        id: &str,
        sequence: u64,
    ) -> Result<Response, Diagnostic> {
        let v = self.stored(&q.revision)?;
        let t = self
            .transfers
            .get(id)
            .ok_or_else(|| problem("REVISION_MISMATCH", "Transfer revision mismatch"))?;
        if t.request_id != q.request_id || !same(&t.revision, &q.revision) {
            return Err(problem("REVISION_MISMATCH", "Transfer revision mismatch"));
        }
        if t.sequence != sequence {
            return Err(problem("INVALID_REQUEST", "Unknown transfer or sequence"));
        }
        let count = if t.ignore_selection {
            v.eligible.len()
        } else {
            selection::presented(v, &v.selection).count()
        };
        let rows: Box<dyn Iterator<Item = &DatasetRow>> = if t.ignore_selection {
            Box::new(v.eligible.iter())
        } else {
            selection::presented(v, &v.selection)
        };
        let start = t.offset;
        let end = start.saturating_add(self.batch_rows as usize).min(count);
        let fields = v.columns.iter().map(|c| c.id.clone()).collect::<Vec<_>>();
        let (reservation, rows) = resources::bounded_rows(rows.skip(start).take(end - start));
        resources::check(
            self.limits.max_state_bytes,
            self.retained_bytes().saturating_add(reservation),
            "Export transient state budget exceeded",
        )?;
        let batch_rows = project(rows, &fields);
        if let Some(max) = self.limits.export_bytes {
            if resources::wire_size(&batch_rows) > max {
                return Err(problem("RESOURCE_LIMIT", "Export batch budget exceeded"));
            }
        }
        let provenance = (sequence == 0).then(|| {
            let mut provenance = v.provenance.clone();
            provenance.presentation = Some(PresentationProvenance {
                scope: PresentedScope::Presented,
                row_count: count as u64,
                revision: q.revision.clone(),
            });
            provenance
        });
        let final_batch = end >= count;
        let batch = SubsetBatch {
            transfer_id: id.into(),
            sequence,
            rows: batch_rows,
            final_batch,
            columns: (sequence == 0).then(|| v.columns.clone()),
            provenance,
            freshness: (sequence == 0).then(|| v.freshness.clone()),
        };
        resources::check(
            self.limits.max_batch_bytes,
            resources::wire_size(&batch).saturating_add(self.envelope_wire_bytes(q)),
            "Export batch including metadata budget exceeded",
        )?;
        if final_batch {
            self.transfers.remove(id);
        } else {
            let t = self.transfers.get_mut(id).unwrap();
            t.sequence += 1;
            t.offset = end;
        }
        Ok(Response::Subset(batch))
    }
}
