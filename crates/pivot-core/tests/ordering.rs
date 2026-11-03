// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use pivot_core::{
    contract::*,
    ordering::{CachedOrder, Comparison, ValueOrder},
};
use std::{cell::Cell, cmp::Ordering};
mod support;
use support::compare_values;
struct Host {
    scalar_fail: bool,
    raw_fail: bool,
    scalar_calls: Cell<usize>,
    raw_calls: Cell<usize>,
}
impl ValueOrder for Host {
    fn compare(&self, _a: &WireValue, _b: &WireValue) -> Result<Ordering, Diagnostic> {
        self.scalar_calls.set(self.scalar_calls.get() + 1);
        if self.scalar_fail {
            Err(pivot_core::validation::diagnostic(
                "SCALAR",
                "host",
                "scalar failed",
            ))
        } else {
            Ok(Ordering::Less)
        }
    }
    fn compare_raw(&self, _a: &WireValue, _b: &WireValue) -> Result<Comparison, Diagnostic> {
        self.raw_calls.set(self.raw_calls.get() + 1);
        if self.raw_fail {
            Err(pivot_core::validation::diagnostic(
                "RAW",
                "host",
                "raw failed",
            ))
        } else {
            Ok(Comparison::Unordered)
        }
    }
}
fn value(n: f64) -> WireValue {
    WireValue::F64(WireNumber::Finite(n))
}
#[test]
fn scalar_and_raw_callbacks_have_independent_success_only_caches_with_combined_bound() {
    for (scalar_fail, raw_fail) in [(true, false), (false, true), (false, false)] {
        let host = Host {
            scalar_fail,
            raw_fail,
            scalar_calls: Cell::new(0),
            raw_calls: Cell::new(0),
        };
        let cache = CachedOrder::new(&host, 2);
        for _ in 0..2 {
            let scalar = cache.compare(&value(1.), &value(2.));
            assert_eq!(scalar.is_err(), scalar_fail);
            if let Err(d) = scalar {
                assert_eq!(d.code, "SCALAR")
            }
            let raw = cache.compare_raw(&value(1.), &value(2.));
            assert_eq!(raw.is_err(), raw_fail);
            if let Ok(raw) = raw {
                assert_eq!(raw, Comparison::Unordered)
            } else {
                assert_eq!(raw.unwrap_err().code, "RAW")
            }
        }
        assert_eq!(host.scalar_calls.get(), if scalar_fail { 2 } else { 1 });
        assert_eq!(host.raw_calls.get(), if raw_fail { 2 } else { 1 });
        for n in 3..10 {
            let _ = cache.compare(&value(n as f64), &value(2.));
            let _ = cache.compare_raw(&value(n as f64), &value(2.));
            assert!(cache.cache_size() <= 2);
        }
    }
}

#[test]
fn sorting_moves_payload_and_no_keys_do_not_clone() {
    use pivot_core::ordering::sort_by_keys;
    struct Item<'a>(usize, &'a Cell<usize>);
    impl Clone for Item<'_> {
        fn clone(&self) -> Self {
            self.1.set(self.1.get() + 1);
            Self(self.0, self.1)
        }
    }
    struct Numeric;
    impl ValueOrder for Numeric {
        fn compare(&self, a: &WireValue, b: &WireValue) -> Result<Ordering, Diagnostic> {
            Ok(compare_values(a, b, &|_, _| panic!("numeric only")))
        }
    }
    let clones = Cell::new(0);
    let mut items = [Item(0, &clones), Item(1, &clones), Item(2, &clones)];
    sort_by_keys(&mut items, &[vec![], vec![], vec![]], &[], &Numeric).unwrap();
    assert_eq!(
        clones.get(),
        0,
        "no-key sort must leave owned descendants in place"
    );
    sort_by_keys(
        &mut items,
        &[vec![value(2.)], vec![value(3.)], vec![value(1.)]],
        &[false],
        &Numeric,
    )
    .unwrap();
    assert_eq!(items.iter().map(|i| i.0).collect::<Vec<_>>(), [2, 0, 1]);
    assert_eq!(clones.get(), 0, "permutation must move payloads");
    assert!(sort_by_keys(&mut items, &[vec![]], &[], &Numeric).is_err());
}

struct AllocationCounter;
thread_local! {
    static COUNT_ALLOCATIONS: Cell<bool> = const { Cell::new(false) };
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}
unsafe impl std::alloc::GlobalAlloc for AllocationCounter {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        let _ = COUNT_ALLOCATIONS.try_with(|enabled| {
            if enabled.get() {
                ALLOCATIONS.with(|n| n.set(n.get() + 1));
            }
        });
        unsafe { std::alloc::System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }
}
#[global_allocator]
static ALLOCATOR: AllocationCounter = AllocationCounter;
#[test]
fn warmed_numeric_cache_hits_do_not_allocate_or_repeat_host_calls() {
    let host = Host {
        scalar_fail: false,
        raw_fail: false,
        scalar_calls: Cell::new(0),
        raw_calls: Cell::new(0),
    };
    let cache = CachedOrder::new(&host, 2);
    let a = value(123.5);
    let b = value(-789.25);
    cache.compare_raw(&a, &b).unwrap();
    ALLOCATIONS.with(|n| n.set(0));
    COUNT_ALLOCATIONS.with(|enabled| enabled.set(true));
    for _ in 0..100 {
        assert_eq!(cache.compare_raw(&a, &b).unwrap(), Comparison::Unordered);
    }
    COUNT_ALLOCATIONS.with(|enabled| enabled.set(false));
    assert_eq!(
        ALLOCATIONS.with(|n| n.get()),
        0,
        "numeric cache hits must not construct strings"
    );
    assert_eq!(
        host.raw_calls.get(),
        1,
        "the negotiated callback stays authoritative and cached"
    );
}
#[test]
fn cache_keeps_signed_zero_types_and_compound_entry_order_distinct() {
    let host = Host {
        scalar_fail: false,
        raw_fail: false,
        scalar_calls: Cell::new(0),
        raw_calls: Cell::new(0),
    };
    let cache = CachedOrder::new(&host, 64);
    let variants = [
        value(0.),
        value(-0.),
        WireValue::F64(WireNumber::Special(SpecialNumber::NegativeZero)),
        WireValue::String("0".into()),
        WireValue::BigIntString("0".into()),
        WireValue::Bool(false),
        WireValue::Null,
        WireValue::Missing,
        WireValue::Record(vec![("a".into(), value(1.)), ("b".into(), value(2.))]),
        WireValue::Record(vec![("b".into(), value(2.)), ("a".into(), value(1.))]),
    ];
    for a in &variants {
        cache.compare_raw(a, &value(1.)).unwrap();
    }
    for a in &variants {
        cache.compare_raw(a, &value(1.)).unwrap();
    }
    assert_eq!(host.raw_calls.get(), variants.len());
    assert_eq!(cache.cache_size(), variants.len());
}
