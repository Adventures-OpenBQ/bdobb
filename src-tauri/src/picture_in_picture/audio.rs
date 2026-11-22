// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

//! Only the captured player's exact English audio button is eligible.

pub fn unique_control<'a>(names: impl IntoIterator<Item = &'a str>) -> Option<(usize, bool)> {
    let mut found = None;
    for (index, name) in names.into_iter().enumerate() {
        let muted = match name { "Mute" => false, "Unmute" => true, _ => continue };
        if found.is_some() { return None; }
        found = Some((index, muted));
    }
    found
}

/// A hidden native control is an unavailable observation, not proof of sound.
/// Only the native holder can attach a last-confirmed state for its exact player.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct CapturedAudioState {
    #[serde(flatten)]
    pub audio: super::logic::MuteState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_confirmed: Option<bool>,
}
impl From<super::logic::MuteState> for CapturedAudioState {
    fn from(audio: super::logic::MuteState) -> Self { Self { audio, last_confirmed: None } }
}

pub struct AudioHistory<K> { last: Option<(K, bool)> }
impl<K> Default for AudioHistory<K> { fn default() -> Self { Self { last: None } } }
impl<K: PartialEq> AudioHistory<K> {
    pub fn clear(&mut self) { self.last = None; }
    pub fn observe(&mut self, key: K, result: Result<bool, String>, toggle: bool) -> CapturedAudioState {
        use super::logic::MuteState;
        if self.last.as_ref().is_some_and(|(previous, _)| previous != &key) { self.clear(); }
        match result {
            Ok(muted) => {
                self.last = Some((key, muted));
                (if muted { MuteState::Muted } else { MuteState::Sound }).into()
            }
            Err(reason) => {
                // A failed action may have changed audio before confirmation.
                if toggle { self.clear(); }
                CapturedAudioState { audio: MuteState::Unavailable { reason }, last_confirmed: self.last.as_ref().map(|(_, muted)| *muted) }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hidden_controls_keep_only_the_same_players_last_confirmed_audio() {
        let mut history = AudioHistory::default();
        history.observe(1, Ok(true), true);
        let hidden = history.observe(1, Err("hidden".into()), false);
        assert_eq!(hidden, CapturedAudioState { audio: super::super::logic::MuteState::Unavailable { reason: "hidden".into() }, last_confirmed: Some(true) });
        assert_eq!(history.observe(2, Err("hidden".into()), false).last_confirmed, None);
        assert_eq!(history.observe(1, Err("hidden".into()), false).last_confirmed, None);
    }
    #[test]
    fn failed_actions_and_released_bindings_invalidate_last_confirmed_audio() {
        let mut history = AudioHistory::default();
        history.observe(1, Ok(false), false);
        assert_eq!(history.observe(1, Err("hidden".into()), false).last_confirmed, Some(false));
        assert_eq!(history.observe(1, Err("confirmation failed".into()), true).last_confirmed, None);
        assert_eq!(history.observe(1, Err("hidden".into()), false).last_confirmed, None);
        history.observe(1, Ok(true), true);
        history.clear();
        assert_eq!(history.observe(1, Err("hidden".into()), false).last_confirmed, None);
    }
    #[test]
    fn selects_exact_audio_control_and_refuses_ambiguous_controls() {
        assert_eq!(unique_control(["Mute microphone", "Mute", "Close"]), Some((1, false)));
        assert_eq!(unique_control(["Unmute", "Mute microphone"]), Some((0, true)));
        assert_eq!(unique_control(["Mute", "Unmute"]), None);
        assert_eq!(unique_control(["Mute microphone", "Unmute microphone"]), None);
    }
}
