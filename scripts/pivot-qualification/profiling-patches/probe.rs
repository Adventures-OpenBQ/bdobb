// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
//! Copied only into isolated checksum-pinned profiling builds. No production module.
use std::{cell::RefCell, collections::BTreeMap};
#[derive(serde::Serialize)]
#[serde(rename_all="camelCase")]
struct Event { id: String, name: &'static str, start_ms: f64, end_ms: f64, #[serde(skip_serializing_if="Option::is_none")] parent_id: Option<String> }
#[derive(Default)]
struct State { clock: Option<fn()->f64>, events: Vec<Event>, stack: Vec<usize>, counters: BTreeMap<(&'static str,&'static str,&'static str),usize> }
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
pub fn reset(clock: fn()->f64) { STATE.with(|s| *s.borrow_mut()=State{clock:Some(clock),..Default::default()}); }
pub struct Guard(Option<usize>);
pub fn stage(name: &'static str)->Guard { STATE.with(|s| {let mut s=s.borrow_mut();let Some(clock)=s.clock else{return Guard(None)};let i=s.events.len();let parent_id=s.stack.last().map(|n| n.to_string());s.events.push(Event{id:i.to_string(),name,start_ms:clock(),end_ms:0.,parent_id});s.stack.push(i);Guard(Some(i))}) }
impl Drop for Guard { fn drop(&mut self) {if let Some(i)=self.0 {STATE.with(|s| {let mut s=s.borrow_mut();let clock=s.clock.unwrap();s.events[i].end_ms=clock();assert_eq!(s.stack.pop(),Some(i));});}} }
pub fn count(name:&'static str,value:usize,unit:&'static str,scope:&'static str) {STATE.with(|s|{let mut s=s.borrow_mut();if s.clock.is_some(){*s.counters.entry((name,unit,scope)).or_default()+=value;}});}
pub fn read()->String {STATE.with(|s| {let s=s.borrow();assert!(s.stack.is_empty());let counters:Vec<_>=s.counters.iter().map(|((name,unit,scope),value)|serde_json::json!({"name":name,"value":value,"unit":unit,"scope":scope})).collect();serde_json::json!({"accounting":"inclusive-do-not-sum","events":s.events,"counters":counters}).to_string()})}
