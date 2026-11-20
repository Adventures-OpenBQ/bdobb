// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Benchmark snapshot only. This file is never linked into the production core.
use std::{cell::RefCell,collections::BTreeMap};
#[derive(Default)]
struct Trace { clock: Option<fn()->f64>, stack: Vec<f64>, totals: BTreeMap<&'static str,(f64,f64,u64)> }
thread_local! { static TRACE: RefCell<Trace> = RefCell::new(Trace::default()); }
pub fn start(clock:fn()->f64) { TRACE.with(|t| *t.borrow_mut()=Trace {clock:Some(clock),..Default::default()}); }
pub struct Span { name: &'static str, clock: Option<fn()->f64>, start:f64 }
pub fn span(name:&'static str)->Span {
 let clock=TRACE.with(|t| t.borrow().clock);
 let start=clock.map(|c|c()).unwrap_or(0.);
 if clock.is_some() {TRACE.with(|t|t.borrow_mut().stack.push(0.));}
 Span{name,clock,start}
}
impl Drop for Span {
 fn drop(&mut self) {if let Some(clock)=self.clock {
  let elapsed=clock()-self.start;
  TRACE.with(|t|{let mut t=t.borrow_mut();let child=t.stack.pop().expect("balanced spans");
   if let Some(parent)=t.stack.last_mut(){*parent+=elapsed;}
   let a=t.totals.entry(self.name).or_default();a.0+=elapsed;a.1+=(elapsed-child).max(0.);a.2+=1;
  });
 }}
}
pub fn take()->String {TRACE.with(|t|{let mut t=t.borrow_mut();assert!(t.stack.is_empty());t.clock=None;
 serde_json::to_string(&t.totals.iter().map(|(name,(inclusive,exclusive,calls))|serde_json::json!({"name":name,"inclusiveMs":inclusive,"exclusiveMs":exclusive,"calls":calls})).collect::<Vec<_>>()).unwrap()
})}
#[cfg(test)] mod tests {
 use super::*;use std::cell::Cell;
 thread_local! { static TIME:Cell<f64>=const{Cell::new(0.)}; }
 fn clock()->f64 {TIME.with(|v|v.get())}
 #[test] fn nested_spans_do_not_double_count(){
  TIME.with(|v|v.set(0.));start(clock);
  {let _a=span("outer");TIME.with(|v|v.set(2.));{let _b=span("inner");TIME.with(|v|v.set(7.));}TIME.with(|v|v.set(10.));}
  let rows:serde_json::Value=serde_json::from_str(&take()).unwrap();
  assert_eq!(rows[0]["exclusiveMs"],5.);assert_eq!(rows[1]["inclusiveMs"],10.);assert_eq!(rows[1]["exclusiveMs"],5.);
  {let _disabled=span("disabled");}assert!(!take().contains("disabled"));
 }
}
