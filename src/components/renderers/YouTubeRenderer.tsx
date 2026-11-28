// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { isYouTubeEmbed, youtubeEmbedUrl } from "../../lib/youtube";
import { PIP_GRAB_CHANNEL, PIP_GRAB_MARKER, youtubePlayback, youtubePlaybackUrl, type YoutubePlayback } from "../../lib/youtubePlayback";
import { closeYoutubePip, desktopVideoPipAvailable, openYoutubePip, youtubePipIsOpen } from "../../lib/youtubePip";
import { SRC_FRAME_SANDBOX } from "./HtmlRenderer";
import { channelCardData, PictureInPictureRenderer } from "./PictureInPictureRenderer";
import { capturedPlayerAudio, enqueuePlayerOp, pipPlatform, type CapturedAudioState } from "../../lib/pictureInPicture";
import { useParameterDropdownOpen } from "../../hooks/useParameterDropdownOpen";

const grabSelection = channelCardData(PIP_GRAB_CHANNEL);

type Props = {
  data: unknown;
  cardId?: string;
  settings?: YoutubePlayback;
  controlsHost?: HTMLElement | null;
  onSettingsChange?: (settings: YoutubePlayback) => Promise<unknown>;
  viewer?: boolean;
  readOnly?: boolean;
  menuOpen?: boolean;
  /** Live TV plays streams inline; Chrome grab is a separate selected source. */
  inlineOnly?: boolean;
  rowZeroHost?: HTMLElement | null;
};

/** Only validated YouTube ids reach either player. Client playback preferences
 * stay out of provider parameters. Old data-only callers retain their URL contract.
 * The native bridge serializes ownership changes; inline playback waits for close.
 */
export function YouTubeRenderer({ data, cardId, settings, controlsHost, onSettingsChange, viewer = false, readOnly = false, menuOpen = false, inlineOnly = false, rowZeroHost }: Props) {
  const text = typeof data === "string" ? data : "";
  const locallySelected = useSyncExternalStore(grabSelection.subscribe, () => !!cardId && grabSelection.has(cardId));
  const grab = Boolean(cardId && locallySelected && text === PIP_GRAB_MARKER);
  const direct = youtubeEmbedUrl(text);
  const wantPort = direct !== null;
  const id = direct?.split("/embed/")[1] ?? null;
  const native = Boolean(cardId && !viewer && desktopVideoPipAvailable());
  const [prefs, setPrefs] = useState(() => youtubePlayback(settings));
  const [port, setPort] = useState<number | null | undefined>(undefined);
  const [phase, setPhase] = useState<"inline" | "opening" | "pip" | "closing" | "error">(() => native && (inlineOnly || grab) ? "closing" : native && prefs.display === "pip" ? "opening" : "inline");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const requested = useRef(false);
  const saveRef = useRef(onSettingsChange);
  saveRef.current = onSettingsChange;
  const wantPip = native && !inlineOnly && !grab && prefs.display === "pip";
  const focusNext = useRef(false);
  const dropdownOpen = useParameterDropdownOpen();
  const [capturedAudio, setCapturedAudio] = useState<CapturedAudioState>({state: "unavailable", reason: "Read the captured player's audio"});
  const [audioBusy, setAudioBusy] = useState(false);
  const audioEpoch = useRef(0);
  const audioBusyRef = useRef(false);
  const capturedAvailable = grab && !viewer && ["macos", "windows"].includes(pipPlatform());

  useEffect(() => {
    const epoch = ++audioEpoch.current;
    setCapturedAudio({state: "unavailable", reason: "Read the captured player's audio"});
    if (!capturedAvailable || !cardId || phase !== "inline" || menuOpen || dropdownOpen) return;
    const read = () => {
      if (audioBusyRef.current) return;
      void enqueuePlayerOp(cardId, () => audioEpoch.current === epoch && grabSelection.has(cardId) ? capturedPlayerAudio(cardId) : Promise.resolve<CapturedAudioState>({state: "unavailable", reason: "Source changed"}))
        .then(state => { if (audioEpoch.current === epoch) setCapturedAudio(state); }).catch(() => {});
    };
    read();
    const timer = setInterval(read, 5000);
    return () => { audioEpoch.current = epoch + 1; clearInterval(timer); };
  }, [capturedAvailable, cardId, phase, menuOpen, dropdownOpen]);

  async function toggleCapturedAudio() {
    if (!capturedAvailable || !cardId || menuOpen || dropdownOpen || audioBusyRef.current) return;
    const epoch = audioEpoch.current;
    audioBusyRef.current = true; setAudioBusy(true);
    try {
      const state = await enqueuePlayerOp(cardId, () => audioEpoch.current === epoch && grabSelection.has(cardId) ? capturedPlayerAudio(cardId, true) : Promise.resolve<CapturedAudioState>({state: "unavailable", reason: "Source changed"}));
      if (audioEpoch.current === epoch) setCapturedAudio(state);
    } catch { if (audioEpoch.current === epoch) setCapturedAudio({state: "unavailable", reason: "Chrome's audio control did not answer"}); }
    finally { audioBusyRef.current = false; setAudioBusy(false); }
  }

  const savedDisplay = settings?.display;
  const savedAutoplay = settings?.autoplay;
  const savedMuted = settings?.muted;
  useEffect(() => { setPrefs(youtubePlayback({display: savedDisplay, autoplay: savedAutoplay, muted: savedMuted})); }, [savedDisplay, savedAutoplay, savedMuted]);
  useEffect(() => {
    if (!wantPort) return;
    let live = true;
    invoke<number | null>("video_wrapper_port").then(
      p => { if (live) setPort(typeof p === "number" ? p : null); },
      () => { if (live) setPort(null); },
    );
    return () => { live = false; };
  }, [wantPort]);

  useEffect(() => {
    if (!native || !cardId) { setPhase("inline"); return; }
    let live = true;
    if (inlineOnly || grab) {
      // Also runs on a fresh mount after the loading screen. The card-keyed
      // native queue waits for any cleanup started by the prior renderer.
      setPhase("closing");
      closeYoutubePip(cardId).then(
        () => { if (live) { requested.current = false; setPhase("inline"); setError(""); } },
        reason => { if (live) { setPhase("error"); setError(`Could not close video: ${String(reason)}`); } },
      );
    } else if (wantPip && id) {
      requested.current = true;
      setPhase("opening");
      const focus = focusNext.current;
      focusNext.current = false;
      openYoutubePip(cardId, id, {display: "pip", autoplay: prefs.autoplay, muted: prefs.muted}, focus).then(
        opened => { if (live) {
          if (opened === false) { setPrefs(current => ({...current, display: "inline"})); setPhase("inline"); }
          else setPhase("pip");
          setError("");
        } },
        reason => { if (live) { setPhase("error"); setError(`Could not open video: ${String(reason)}`); } },
      );
    } else if (requested.current) {
      setPhase("closing");
      closeYoutubePip(cardId).then(
        () => { if (live) { requested.current = false; setPhase("inline"); setError(""); } },
        reason => { if (live) { setPhase("error"); setError(`Could not close video: ${String(reason)}`); } },
      );
    } else setPhase("inline");
    return () => { live = false; };
  }, [native, cardId, id, wantPip, prefs.autoplay, prefs.muted, inlineOnly, grab]);

  useEffect(() => () => {
    if (cardId && requested.current) void closeYoutubePip(cardId).catch(() => undefined);
  }, [cardId]);

  // A native title-bar close returns playback to the card without reopening it.
  useEffect(() => {
    if (phase !== "pip" || !cardId) return;
    let live = true;
    const timer = setInterval(() => {
      void youtubePipIsOpen(cardId).then(open => {
        if (!live || open) return;
        live = false;
        requested.current = false;
        const next = {...prefs, display: "inline" as const};
        setPrefs(next);
        setPhase("inline");
        void saveRef.current?.(next).catch(reason => setError(`Could not save playback choice: ${String(reason)}`));
      }).catch(() => undefined);
    }, 1500);
    return () => { live = false; clearInterval(timer); };
  }, [phase, cardId, prefs]);

  async function change(next: YoutubePlayback, focus = false) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    focusNext.current = focus;
    try {
      const saved = inlineOnly ? {...next, display: "inline" as const} : next;
      await saveRef.current?.(saved);
      setPrefs(saved);
    } catch (reason) { focusNext.current = false; setError(`Could not save playback choice: ${String(reason)}`); }
    finally { savingRef.current = false; setSaving(false); }
  }

  const controls = controlsHost && onSettingsChange && !viewer && !grab ? createPortal(
    <div className="video-playback-config">
      <label><input type="checkbox" checked={prefs.muted} disabled={saving} onChange={e => void change({...prefs, muted: e.target.checked})} /> Start muted</label>
      <label><input type="checkbox" checked={prefs.autoplay} disabled={saving} onChange={e => void change({...prefs, autoplay: e.target.checked})} /> Autoplay</label>
    </div>, controlsHost,
  ) : null;
  const lastConfirmed = capturedAudio.state === "unavailable" ? capturedAudio.lastConfirmed : undefined;
  const audioMuted = grab ? capturedAudio.state === "muted" || lastConfirmed === true : prefs.muted;
  const audioLabel = grab && capturedAudio.state === "unavailable" ? `Toggle captured audio${lastConfirmed === undefined ? "" : ` (last confirmed ${lastConfirmed ? "muted" : "sound"})`}` : audioMuted ? "Unmute" : "Mute";
  const audio = rowZeroHost && !viewer ? createPortal(
    <button type="button" className="card-action video-mute" aria-label={audioLabel}
      title={grab && capturedAudio.state === "unavailable" ? `${lastConfirmed === undefined ? "" : `Last confirmed ${lastConfirmed ? "muted" : "sound"}. `}${capturedAudio.reason}` : audioLabel}
      disabled={saving || audioBusy || (grab && (!capturedAvailable || phase !== "inline" || menuOpen || dropdownOpen))} onClick={() => grab ? void toggleCapturedAudio() : void change({...prefs, muted: !prefs.muted})}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4V5Z"/>{audioMuted ? <path d="m16 9 5 6m0-6-5 6"/> : <><path d="M15 8a6 6 0 0 1 0 8"/><path d="M18 5a10 10 0 0 1 0 14"/></>}
      </svg>
    </button>, rowZeroHost,
  ) : null;
  const src = cardId
    ? port ? youtubePlaybackUrl(text, port, prefs) : direct ? `${direct}?autoplay=${prefs.autoplay ? 1 : 0}&mute=${prefs.muted ? 1 : 0}&playsinline=1` : null
    : youtubeEmbedUrl(text, port ?? undefined);
  const inline = !wantPip && phase === "inline";
  if (grab && cardId) return <>
    {audio}
    {phase === "inline"
      ? <PictureInPictureRenderer cardId={cardId} readOnly={viewer || readOnly} menuOpen={menuOpen} requiredChannel={PIP_GRAB_CHANNEL} />
      : <p className="empty-state">{phase === "error" ? "Player unavailable" : "Returning video to card…"}</p>}
    {error ? <p role="alert">{error}</p> : null}
  </>;
  return <>
    {audio}
    {controls}
    {direct === null ? <p className="empty-state">{cardId ? "No video is currently available for the selected source." : "Select a video in the widget's parameters."}</p> : <div className="youtube-player">
      {native && !inlineOnly ? <div className="video-playback-actions"><button type="button" disabled={saving || phase === "closing"} onClick={() => void change({...prefs, display: wantPip ? "inline" : "pip"}, !wantPip)}>{wantPip ? "Return video to card" : "Picture in Picture"}</button></div> : null}
      {inline ? <div className="iframe-wrap">{port !== undefined && src ? <iframe className="widget-frame" title="YouTube video" src={src}
        sandbox={isYouTubeEmbed(src) ? undefined : `${SRC_FRAME_SANDBOX} allow-presentation`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /> : null}</div>
        : <p className="empty-state">{phase === "opening" ? "Opening Picture in Picture…" : phase === "closing" ? "Returning video to card…" : phase === "pip" ? "Playing in Picture in Picture" : "Player unavailable"}</p>}
    </div>}
    {error ? <p role="alert">{error}</p> : null}
  </>;
}
