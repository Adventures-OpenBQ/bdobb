// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/// The accessibility element selected for one placement lifetime.
pub struct PlayerBinding<T> { player: Option<T>, lost: bool }
impl<T> Default for PlayerBinding<T> { fn default() -> Self { Self { player: None, lost: false } } }
impl<T> PlayerBinding<T> {
    pub fn reset(&mut self) { self.player = None; self.lost = false; }
    pub fn get(
        &mut self,
        mut valid: impl FnMut(&T) -> Result<bool, String>,
        discover: impl FnOnce() -> Result<Option<T>, String>,
    ) -> Result<Option<&T>, String> {
        if let Some(player) = &self.player {
            if valid(player)? { return Ok(self.player.as_ref()); }
        }
        if self.player.is_some() { self.player = None; self.lost = true; }
        if !self.lost { self.player = discover()?; }
        Ok(self.player.as_ref())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_the_original_element_while_it_answers() {
        let mut binding = PlayerBinding::default();
        assert_eq!(binding.get(|_|Ok(true), ||Ok(Some(1))).unwrap(), Some(&1));
        assert_eq!(binding.get(|_|Ok(true), ||Ok(Some(2))).unwrap(), Some(&1));
    }
    #[test]
    fn a_transient_accessibility_failure_does_not_replace_the_element() {
        let mut binding = PlayerBinding::default();
        binding.get(|_|Ok(true), ||Ok(Some(1))).unwrap();
        assert!(binding.get(|_|Err("timeout".into()), ||Ok(Some(2))).is_err());
        assert_eq!(binding.get(|_|Ok(true), ||Ok(Some(2))).unwrap(), Some(&1));
    }
    #[test]
    fn a_closed_element_never_selects_a_replacement_during_the_same_hold() {
        let mut binding = PlayerBinding::default();
        binding.get(|_|Ok(true), ||Ok(Some(1))).unwrap();
        assert_eq!(binding.get(|_|Ok(false), ||Ok(Some(2))).unwrap(), None);
        assert_eq!(binding.get(|_|Ok(true), ||Ok(Some(2))).unwrap(), None);
    }

}
