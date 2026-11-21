// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/* global document, window, YT, setInterval, clearInterval */
// Fixed YouTube controller for the app's validated loopback page.
(() => {
  const root = document.documentElement;
  let timer;
  const record = player => {
    try {
      root.dataset.playerState = String(player.getPlayerState());
      root.dataset.currentTime = String(player.getCurrentTime());
      root.dataset.playerMuted = String(player.isMuted());
    } catch { /* The iframe may be between source loads. */ }
  };
  window.onYouTubeIframeAPIReady = () => {
    new YT.Player('player', {
      events: {
        onReady: event => {
          const player = event.target;
          if (root.dataset.startMuted === 'true') player.mute();
          else player.unMute();
          if (root.dataset.autoplay === 'true') player.playVideo();
          record(player);
          timer = setInterval(() => record(player), 500);
        },
        onStateChange: event => record(event.target),
        onError: event => { root.dataset.playerError = String(event.data); },
      },
    });
  };
  const api = document.createElement('script');
  api.src = 'https://www.youtube.com/iframe_api';
  api.onerror = () => { root.dataset.playerError = 'controls-unavailable'; };
  document.head.appendChild(api);
  window.addEventListener('pagehide', () => clearInterval(timer), {once: true});
})();
