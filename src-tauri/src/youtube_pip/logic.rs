// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
pub fn card_label(card: &str) -> Result<String, &'static str> {
    if card.is_empty() || card.len() > 100 || !card.bytes().all(|b|b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        return Err("Invalid video card identity");
    }
    Ok(format!("youtube-pip-{card}"))
}
pub fn is_owned_label(label: &str) -> bool {
    label.strip_prefix("youtube-pip-").is_some_and(|card|card_label(card).is_ok())
}
pub fn validate_owner(label: &str) -> Result<(), &'static str> {
    if label == "main" {Ok(())} else {Err("Only the main app can control video windows")}
}
pub fn player_url(port: u16, id: &str, autoplay: bool, muted: bool) -> Result<String, &'static str> {
    if port == 0 || id.len() != 11 || !id.bytes().all(|b|b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        return Err("Invalid YouTube player input");
    }
    Ok(format!("http://127.0.0.1:{port}/yt?id={id}&autoplay={}&muted={}", u8::from(autoplay), u8::from(muted)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_only_the_owned_video_window() {
        assert_eq!(card_label("abc-123").unwrap(), "youtube-pip-abc-123");
        for id in ["", "../main", "main?x=1", "a b", &"x".repeat(101)] {
            assert!(card_label(id).is_err());
        }
        assert!(is_owned_label("youtube-pip-abc-123"));
        for label in ["main", "dash-x", "youtube-pip-", "youtube-pip-../main"] {
            assert!(!is_owned_label(label));
        }
    }
    #[test]
    fn only_the_main_app_can_request_media_windows() {
        assert!(validate_owner("main").is_ok());
        for name in ["dash-one", "youtube-pip-abc", ""] {assert!(validate_owner(name).is_err());}
    }
    #[test]
    fn builds_a_fixed_loopback_player_url_with_boolean_preferences() {
        assert_eq!(player_url(41234,"uYyhswnZkSw",true,false).unwrap(),
            "http://127.0.0.1:41234/yt?id=uYyhswnZkSw&autoplay=1&muted=0");
        assert_eq!(player_url(41234,"uYyhswnZkSw",false,true).unwrap(),
            "http://127.0.0.1:41234/yt?id=uYyhswnZkSw&autoplay=0&muted=1");
        assert!(player_url(0,"uYyhswnZkSw",false,false).is_err());
        for id in ["tooShort", "uYyhswnZkSw&x=1", "https://evil.example", "uYyhs<nZkSw"] {
            assert!(player_url(41234,id,false,false).is_err());
        }
    }
}
