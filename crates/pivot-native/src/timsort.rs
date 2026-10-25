// Copyright 2026 SecretoftheUniverse.com LLC. Modifications licensed under Apache-2.0.
// SPDX-License-Identifier: AGPL-3.0-only AND BSD-3-Clause AND Python-2.0
// Derived from Node v26.10.0 / V8 14.6.202.34 array-sort.tq (TimSort).
// Copyright 2001–2018 Python Software Foundation. All rights reserved.
// Copyright 2026 SecretoftheUniverse.com LLC.
// See ../THIRD_PARTY_NOTICES for V8's BSD and PSF license terms.
//
// Comparison order is observable for the baseline's nontransitive mixed values.
// Keep run detection, binary insertion, merge scheduling and galloping aligned
// with the pinned V8 implementation. Unlike Rust slice::sort, this algorithm
// explicitly handles inconsistent comparisons without assuming a total order.
use std::cmp::Ordering;
type Index = usize;
pub(crate) fn sort<E, F>(a: &mut [Index], cmp: F) -> Result<(), E>
where
    F: FnMut(Index, Index) -> Result<Ordering, E>,
{
    if a.len() < 2 {
        return Ok(());
    }
    let mut n = a.len();
    let mut r = 0;
    while n >= 64 {
        r |= n & 1;
        n >>= 1;
    }
    let minrun = n + r;
    let mut state = State {
        a,
        cmp,
        runs: Vec::new(),
        min_gallop: 7,
    };
    let mut low = 0;
    while low < state.a.len() {
        let mut len = state.run(low)?;
        if len < minrun {
            let forced = minrun.min(state.a.len() - low);
            state.insertion(low, low + len, low + forced)?;
            len = forced;
        }
        state.runs.push((low, len));
        state.collapse()?;
        low += len;
    }
    while state.runs.len() > 1 {
        let mut n = state.runs.len() - 2;
        if n > 0 && state.runs[n - 1].1 < state.runs[n + 1].1 {
            n -= 1;
        }
        state.merge_at(n)?;
    }
    Ok(())
}
struct State<'a, F> {
    a: &'a mut [Index],
    cmp: F,
    runs: Vec<(usize, usize)>,
    min_gallop: usize,
}
impl<E, F> State<'_, F>
where
    F: FnMut(Index, Index) -> Result<Ordering, E>,
{
    fn run(&mut self, low: usize) -> Result<usize, E> {
        if low + 1 == self.a.len() {
            return Ok(1);
        }
        let desc = (self.cmp)(self.a[low + 1], self.a[low])? == Ordering::Less;
        let mut end = low + 2;
        while end < self.a.len() {
            let less = (self.cmp)(self.a[end], self.a[end - 1])? == Ordering::Less;
            if less != desc {
                break;
            }
            end += 1;
        }
        if desc {
            self.a[low..end].reverse();
        }
        Ok(end - low)
    }
    fn insertion(&mut self, low: usize, start: usize, high: usize) -> Result<(), E> {
        for i in start.max(low + 1)..high {
            let pivot = self.a[i];
            let (mut left, mut right) = (low, i);
            while left < right {
                let mid = left + (right - left) / 2;
                if (self.cmp)(pivot, self.a[mid])? == Ordering::Less {
                    right = mid;
                } else {
                    left = mid + 1;
                }
            }
            self.a.copy_within(left..i, left + 1);
            self.a[left] = pivot;
        }
        Ok(())
    }
    fn invariant(&self, n: usize) -> bool {
        n < 2 || self.runs[n - 2].1 > self.runs[n - 1].1 + self.runs[n].1
    }
    fn collapse(&mut self) -> Result<(), E> {
        while self.runs.len() > 1 {
            let mut n = self.runs.len() - 2;
            if !self.invariant(n + 1) || !self.invariant(n) {
                if self.runs[n - 1].1 < self.runs[n + 1].1 {
                    n -= 1;
                }
            } else if self.runs[n].1 > self.runs[n + 1].1 {
                break;
            }
            self.merge_at(n)?;
        }
        Ok(())
    }
    fn merge_at(&mut self, i: usize) -> Result<(), E> {
        let (mut base_a, mut len_a) = self.runs[i];
        let (base_b, mut len_b) = self.runs[i + 1];
        self.runs[i].1 += len_b;
        self.runs.remove(i + 1);
        let k = gallop(
            self.a,
            self.a[base_b],
            base_a,
            len_a,
            0,
            true,
            &mut self.cmp,
        )?;
        base_a += k;
        len_a -= k;
        if len_a == 0 {
            return Ok(());
        }
        len_b = gallop(
            self.a,
            self.a[base_a + len_a - 1],
            base_b,
            len_b,
            len_b - 1,
            false,
            &mut self.cmp,
        )?;
        if len_b == 0 {
            return Ok(());
        }
        if len_a <= len_b {
            self.merge_low(base_a, len_a, base_b, len_b)
        } else {
            self.merge_high(base_a, len_a, base_b, len_b)
        }
    }
    fn merge_low(
        &mut self,
        base_a: usize,
        mut a: usize,
        base_b: usize,
        mut b: usize,
    ) -> Result<(), E> {
        let temp = self.a[base_a..base_a + a].to_vec();
        let (mut dest, mut ca, mut cb) = (base_a, 0, base_b);
        self.a[dest] = self.a[cb];
        dest += 1;
        cb += 1;
        b -= 1;
        let mut min = self.min_gallop;
        'merge: while b > 0 && a > 1 {
            let (mut wa, mut wb) = (0, 0);
            loop {
                if (self.cmp)(self.a[cb], temp[ca])? == Ordering::Less {
                    self.a[dest] = self.a[cb];
                    dest += 1;
                    cb += 1;
                    b -= 1;
                    wb += 1;
                    wa = 0;
                    if b == 0 {
                        break 'merge;
                    }
                    if wb >= min {
                        break;
                    }
                } else {
                    self.a[dest] = temp[ca];
                    dest += 1;
                    ca += 1;
                    a -= 1;
                    wa += 1;
                    wb = 0;
                    if a == 1 {
                        break 'merge;
                    }
                    if wa >= min {
                        break;
                    }
                }
            }
            min += 1;
            let mut first = true;
            while wa >= 7 || wb >= 7 || first {
                first = false;
                min = 1.max(min - 1);
                self.min_gallop = min;
                wa = gallop(&temp, self.a[cb], ca, a, 0, true, &mut self.cmp)?;
                if wa > 0 {
                    self.a[dest..dest + wa].copy_from_slice(&temp[ca..ca + wa]);
                    dest += wa;
                    ca += wa;
                    a -= wa;
                    if a <= 1 {
                        break 'merge;
                    }
                }
                self.a[dest] = self.a[cb];
                dest += 1;
                cb += 1;
                b -= 1;
                if b == 0 {
                    break 'merge;
                }
                wb = gallop(self.a, temp[ca], cb, b, 0, false, &mut self.cmp)?;
                if wb > 0 {
                    self.a.copy_within(cb..cb + wb, dest);
                    dest += wb;
                    cb += wb;
                    b -= wb;
                    if b == 0 {
                        break 'merge;
                    }
                }
                self.a[dest] = temp[ca];
                dest += 1;
                ca += 1;
                a -= 1;
                if a == 1 {
                    break 'merge;
                }
            }
            min += 1;
            self.min_gallop = min;
        }
        if a == 1 && b > 0 {
            self.a.copy_within(cb..cb + b, dest);
            self.a[dest + b] = temp[ca];
        } else if a > 0 {
            self.a[dest..dest + a].copy_from_slice(&temp[ca..ca + a]);
        }
        Ok(())
    }
    fn merge_high(
        &mut self,
        base_a: usize,
        mut a: usize,
        base_b: usize,
        mut b: usize,
    ) -> Result<(), E> {
        let temp = self.a[base_b..base_b + b].to_vec();
        // End-exclusive cursors avoid unsigned underflow when a run is exhausted.
        let (mut dest, mut ca, mut cb) = (base_b + b, base_a + a, b);
        dest -= 1;
        ca -= 1;
        self.a[dest] = self.a[ca];
        a -= 1;
        let mut min = self.min_gallop;
        'merge: while a > 0 && b > 1 {
            let (mut wa, mut wb) = (0, 0);
            loop {
                if (self.cmp)(temp[cb - 1], self.a[ca - 1])? == Ordering::Less {
                    dest -= 1;
                    ca -= 1;
                    self.a[dest] = self.a[ca];
                    a -= 1;
                    wa += 1;
                    wb = 0;
                    if a == 0 {
                        break 'merge;
                    }
                    if wa >= min {
                        break;
                    }
                } else {
                    dest -= 1;
                    cb -= 1;
                    self.a[dest] = temp[cb];
                    b -= 1;
                    wb += 1;
                    wa = 0;
                    if b == 1 {
                        break 'merge;
                    }
                    if wb >= min {
                        break;
                    }
                }
            }
            min += 1;
            let mut first = true;
            while wa >= 7 || wb >= 7 || first {
                first = false;
                min = 1.max(min - 1);
                self.min_gallop = min;
                let k = gallop(self.a, temp[cb - 1], base_a, a, a - 1, true, &mut self.cmp)?;
                wa = a - k;
                if wa > 0 {
                    dest -= wa;
                    ca -= wa;
                    self.a.copy_within(ca..ca + wa, dest);
                    a -= wa;
                    if a == 0 {
                        break 'merge;
                    }
                }
                dest -= 1;
                cb -= 1;
                self.a[dest] = temp[cb];
                b -= 1;
                if b == 1 {
                    break 'merge;
                }
                let k = gallop(&temp, self.a[ca - 1], 0, b, b - 1, false, &mut self.cmp)?;
                wb = b - k;
                if wb > 0 {
                    dest -= wb;
                    cb -= wb;
                    self.a[dest..dest + wb].copy_from_slice(&temp[cb..cb + wb]);
                    b -= wb;
                    if b <= 1 {
                        break 'merge;
                    }
                }
                dest -= 1;
                ca -= 1;
                self.a[dest] = self.a[ca];
                a -= 1;
                if a == 0 {
                    break 'merge;
                }
            }
            min += 1;
            self.min_gallop = min;
        }
        if b == 1 && a > 0 {
            dest -= a;
            ca -= a;
            self.a.copy_within(ca..ca + a, dest);
            self.a[dest - 1] = temp[cb - 1];
        } else if b > 0 {
            self.a[dest - b..dest].copy_from_slice(&temp[..b]);
        }
        Ok(())
    }
}
// Preserve argument direction: nontransitive domains make replacing these
// probes with a different binary search observably change the permutation.
fn gallop<E, F>(
    a: &[Index],
    key: Index,
    base: usize,
    len: usize,
    hint: usize,
    right: bool,
    cmp: &mut F,
) -> Result<usize, E>
where
    F: FnMut(Index, Index) -> Result<Ordering, E>,
{
    let (mut last, mut offset) = (0_isize, 1_isize);
    let hint = hint as isize;
    let len = len as isize;
    let mut less = |index: usize| -> Result<bool, E> {
        if right {
            Ok(cmp(key, a[index])? == Ordering::Less)
        } else {
            Ok(cmp(a[index], key)? == Ordering::Less)
        }
    };
    let probe = less(base + hint as usize)?;
    // Right gallop goes left if key<a[hint]; left gallop goes right if a[hint]<key.
    if probe == right {
        let max = hint + 1;
        while offset < max {
            let p = less(base + (hint - offset) as usize)?;
            if p != right {
                break;
            }
            last = offset;
            offset = offset.saturating_mul(2).saturating_add(1);
        }
        offset = offset.min(max);
        let old = last;
        last = hint - offset;
        offset = hint - old;
    } else {
        let max = len - hint;
        while offset < max {
            let p = less(base + (hint + offset) as usize)?;
            if p == right {
                break;
            }
            last = offset;
            offset = offset.saturating_mul(2).saturating_add(1);
        }
        offset = offset.min(max);
        last += hint;
        offset += hint;
    }
    last += 1;
    while last < offset {
        let mid = last + (offset - last) / 2;
        let p = less(base + mid as usize)?;
        if p == right {
            offset = mid;
        } else {
            last = mid + 1;
        }
    }
    Ok(offset as usize)
}
