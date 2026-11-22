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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selects_exact_audio_control_and_refuses_ambiguous_controls() {
        assert_eq!(unique_control(["Mute microphone", "Mute", "Close"]), Some((1, false)));
        assert_eq!(unique_control(["Unmute", "Mute microphone"]), Some((0, true)));
        assert_eq!(unique_control(["Mute", "Unmute"]), None);
        assert_eq!(unique_control(["Mute microphone", "Unmute microphone"]), None);
    }
}
