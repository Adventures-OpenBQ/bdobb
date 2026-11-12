# Picture in Picture card: a parking spot for Chrome's floating player

Date: 2026-11-12. Repo: Adventures-OpenBQ/bdobb. Status: approved by the user on 2026-11-12 after the probe revision. Approval covers this document only; the implementation plan is not yet written or approved.

This replaces the first version of this document (a see-through card over an ordinary Chrome window, commit 89c0873ce). The probe showed the CNBC popout is Chrome's picture-in-picture window, which already floats above every other window, so a hole in BDOBB is unnecessary. The user chose the parking-spot design on 2026-11-12.

## Intent and decisions

Watch a live video popout (first use: the CNBC player in Chrome) at a fixed place in a BDOBB dashboard without embedding the player. The card is an ordinary blank card that reserves space; BDOBB moves and sizes Chrome's floating player to sit over it. BDOBB never loads, frames or re-transmits the stream. The sites' terms of use were read on 2026-11-12; see "Terms of use" below.

Decided by the user:

- BDOBB controls the player on the macOS desktop app only.
- On iPad the card is a reserved empty space with a hint to park a picture-in-picture video over it. iPadOS gives an app no way to move or mute another app's player, so the user places it by hand and the card has no mute button there.
- Windows is a later, separate design. The controller's operations are kept platform-neutral so a Windows implementation can sit behind them. Until then the Windows desktop app and the web preview show a placeholder.
- Watch only.
- When the card leaves the screen, the player returns to the position and size it had before BDOBB took it.
- A manual mute button on the card. Automatic muting during commercial breaks (the stream shows a fixed slate with looping music) is a later, separate design that will call the same mute.
- Window control uses the macOS Accessibility API.
- Home line is v8 in `Adventures-OpenBQ/bdobb`; the feature carries into every later version. Revised by the user on 2026-11-12: the card is built now, on top of the release walk's v8 carry head (`claude/v8-tauri-2.12-knip`, `d2a87146`: published `release/v8` plus the Tauri 2.12, Knip and parameter-rows carries), on its own branch, and handed to the walk's owner as a further carry so the walk takes it through v9, v10 and main. It goes in only once its tests and the manual acceptance pass; if the walk reaches v8 first, the card is owed after the walk. The native code adds no new crate, so each line's dependency pack is unchanged.
- This document was written in `bdobb-dev/bdobb-v2` (commit 4ca24e3cb there) and copied here unchanged apart from this line and the header. File paths below were checked in that repository, whose v8 tags are a different history, and must be re-checked against this repository's v8 line when the plan is written.

No longer needed, and removed from the design: the transparent window, Tauri's macOS private API, the cut-out layer, all stacking and re-stacking logic, and hiding Chrome's title bar.

## What the probe measured (2026-11-12, macOS 27.2, the user's real CNBC popout)

- The popout is a Chrome window titled `Picture in Picture`, on the system's floating level, visible to Accessibility, with settable position and size.
- Moving and sizing take 1 to 5 ms per call; 30 consecutive moves took under 4 ms. The player can follow a drag.
- Size limits on a 1736 x 1133 display: minimum 284 x 160, maximum 1388 x 781. The shape is locked to 16:9 and the width wins (500 x 500 became 500 x 281).
- The player can sit partly off the right edge. It cannot go above the menu bar.
- A resize is clamped to the screen at the player's current position. Restoring a player that was partly off-screen therefore needs: move fully on-screen, set size, then set position. Doing it in that order restored the player exactly.
- The floating player exposes no playback controls to Accessibility. The CNBC tab it came from does: a Video.js player with a `Mute` button, a `Volume Level` slider and a `Captions` control.
- The `Mute` button cannot be pressed through Accessibility (no press action; a press call reports success and does nothing). Setting the slider's value directly also does nothing.
- Stepping the slider works: each step is 10%, ten steps down reach 0%, ten steps up return to 100%. The slider's value reads back correctly. Chrome stayed in the background throughout and focus did not move.
- Chrome's web accessibility tree was already available without BDOBB turning anything on.
- Bloomberg TV (read-only check): its popout is the same `Picture in Picture` window, and its tab exposes the same Video.js controls with the same labels, including a `Volume Level` slider with step actions. Its slider was not stepped.
- Chrome exposes only the selected tab's page. With Bloomberg selected, CNBC's player controls were unreachable while CNBC kept playing sound in a background tab. The slider route therefore works only while the stream's tab is the selected tab in its window.
- Chrome's own `Mute tab` button in the tab strip is not a usable route: it advertises a press action, but pressing it twice reported success and changed nothing, and the tab whose video is in picture-in-picture shows no such button at all.

Not verified: that 0% is audibly silent (the probe could not hear; the reading was 0%); mute when the CNBC tab is not the selected tab in its window or the window is minimised; BDOBB in full screen; a second display; a non-English Chrome, where the window title differs; a Mac where nothing has yet caused Chrome to build its accessibility tree.

## Architecture

Two units.

**The card (frontend).** A new built-in card, "Picture in Picture", defined beside Website and Clock in `src/lib/builtins.ts` and rendered through the switch in `src/components/WidgetCard.tsx`. Its body is blank. It measures its body's rectangle relative to the window's content and reports it to the native controller when it changes (layout change, card resize, scroll), at most once per screen frame. One setting: "source tab title contains" (optional, empty by default; empty means whichever Chrome window shows the slider), used only to find the tab for mute.

**The window controller (native).** A new Rust module in `src-tauri/src`, implemented for macOS only. Operations: fit (rectangle), release, set muted, is muted, status. These five operations and their arguments name nothing macOS-specific, and on other platforms they answer "not supported", which is what the card's placeholder states read. It finds Chrome's `Picture in Picture` window through Accessibility, converts the card's rectangle to screen coordinates using the BDOBB window's position and display scale, and listens for the BDOBB window moving or resizing so it can re-fit with the last rectangle. The Accessibility calls sit behind a small interface so the logic around them is testable without Chrome. No change to `tauri.conf.json` window settings is needed.

### Flow

1. The card appears and sends its rectangle.
2. The controller checks Accessibility permission, finds the floating player, saves its original position and size, and fits it.
3. Each later rectangle or window change triggers a re-fit.
4. On release (dashboard switch, card scrolled fully out, card removed, BDOBB minimised or quit) the controller restores the saved position and size using the order the probe found, and restores the volume if BDOBB muted it.

### Fitting

The player is 16:9. The controller fits the largest 16:9 rectangle inside the card body, centred, within the measured size limits. The card has a minimum body size of 284 x 160 so the player never overflows it. When the card is partly scrolled out of view the player stays over the card's position and can overlap the header or a dock; when the card is fully out of view the player is released.

## Mute

A mute toggle in the card header with three states: sound on, muted, and unavailable (reason on hover).

- To mute, the controller finds the `Volume Level` slider in the Chrome window whose title contains the card's source text, records its current value, and steps it down to 0%. To unmute, it steps back up to the recorded value.
- The slider's value is the state, so the button stays correct when the user changes the volume in the player.
- The slider's label is a card setting with the default `Volume Level`, so a rename by the site is a settings fix.
- Fallback if the slider route fails on the home line: tell Chrome to run one line in the tab that sets the video's muted flag. This needs a second permission (control of Chrome) and Chrome's "Allow JavaScript from Apple Events" setting.
- The card calls only "set muted" and "is muted"; the later break detector uses the same two operations.

## Defaults accepted with this document

These follow from the player being on top of everything. They were proposed after the probe and accepted when the user approved this document.

1. **Menus and dialogs over the card.** The player covers them. Ruling: do nothing in the first version; the user can drag the dialog or close it.
2. **BDOBB not in front.** The player keeps floating at the card's position over whatever app is in front. Ruling: leave it there, since watching while working elsewhere is the point of a floating player; it is released only by the conditions in the flow above.

## States the card shows

| Condition | Card shows |
| --- | --- |
| Accessibility permission not granted | Explanation and a button that opens the System Settings pane |
| No floating player | "Pop the video out in Chrome"; rechecked every few seconds |
| Player held by another portal card | "The player is in use by another card" |
| Mute control not found, including when the stream's tab is not the selected tab | Player still parks; mute button unavailable with the reason |
| Card in an "Open in new window" viewer window | "Open this dashboard in the main window" |
| iPad | Empty reserved space with the hint "Park a picture-in-picture video here"; no mute button |
| Windows desktop app or web preview | "Available in the macOS desktop app" |

## Scope boundaries

- Main window only. Workspace tiles in the main window work.
- Chrome only, and its one floating player. No window picker.
- No cropping, no automatic break detection, no popping the video out on the user's behalf.
- Known gap, accepted: if BDOBB crashes, the player stays where BDOBB last put it.
- Windows, later design. Expected from general knowledge and not checked: Windows lets an app move another app's top-level window without a permission prompt; UI Automation is the counterpart to macOS Accessibility for reaching the page's volume slider; and Windows has per-application volume, which could mute all of Chrome without touching the page. That design starts with its own probe on a Windows PC or VM.
- To settle when writing the plan: whether the v8 line has a zoom setting that scales the page; whether the new native commands need entries in the generated capabilities; which crate provides the Accessibility bindings.

## Departures settled in the implementation plan

Accepted by the user on 2026-11-12 when the plan was approved. Where these differ from the text above, these govern.

- Cards on the v8 line have no minimum size. A card body smaller than 284 x 160 shows "Make this card at least 284 x 160" and the player is released, instead of the card enforcing a minimum.
- The controller's "status" operation is folded into "fit", which returns the status. The fifth command opens the Accessibility settings pane for the permission button.
- The 1388 x 781 maximum is probably a share of the display, so the controller centres the player using the size Chrome actually applies.
- There is no minimise event. The controller checks whether BDOBB is minimised shortly after it loses focus. Unverified until manual acceptance.
- The script-in-tab mute fallback is not built, since the slider route worked in the probe.
- No capability entries are needed, and there is no page zoom to account for.
- The help guide page must also be added to the help vault's v8.0 snapshot, or the next sync removes it.

## Changes from the first acceptance run

Decided by the user on 2026-11-12 after trying the first build. Where these differ from the text above, these govern.

- **Name.** The card is the Picture in Picture widget, in the product and in the code.
- **Hiding parks the player off screen.** A further probe showed Chrome's floating player cannot be minimised (the attribute is not settable and its minimise button is disabled), but it can be moved fully off screen and back exactly, with the video staying in picture-in-picture. So when the card is hidden, BDOBB parks the player beyond all displays and keeps holding it, and brings it back over the card when the condition ends. Hidden means: the card is scrolled fully out of view; the user switched dashboard or tab; BDOBB is minimised; BDOBB is not the front app; or the card's own menu is open. Clicking the floating player's own controls does not count as leaving BDOBB.
- **Releasing** (back to the original place and size) now happens only when the card is removed, when BDOBB quits or its window closes, or when the card body is smaller than 284 x 160. This replaces the earlier ruling that the player stays put when BDOBB is not in front, and the earlier default that the player covers the card's menu.
- **A parked hold yields.** If another Picture in Picture card comes into view while the player is parked, that card takes it over. A visibly fitted card keeps it.
- **Mute while hidden.** A card setting, off by default. Hiding mutes and returning restores the sound, only if the hide did the muting. Parking for the card's menu never mutes.
- **Trimming whitespace.** The player is aligned to the top of the card body and centred horizontally, and the card has a bottom-edge resize handle on a dashboard and in a locked band.
- **Example site.** Help text uses a Federal Reserve press conference on federalreserve.gov as its one example. Its player was checked on 2026-11-12: the same floating window, and a `Volume Level` slider that stepped from 100% to 90% and back. The Board's site policy puts its material in the public domain, asks for citation, permits linking but not framing, and reserves its seal and name.
- **Not built:** simulating a click to force the pop-out (see Terms of use).
- **Still to verify with a real click:** that clicking the floating player's own controls is recognised and does not park it.

## Terms of use

Read on 2026-11-12 through a summarising fetch, not from the raw pages, and not by a lawyer. This records where the wording points; it is not legal advice. The viewer, not BDOBB, is the party bound by a site's terms.

Sources: the Versant Terms of Service (effective 2025-09-30) and Versant's Prohibited Actions list (undated), which govern CNBC together with CNBC's supplemental terms (updated 2026-04-28); and Bloomberg's Terms of Service (no date shown).

- **Parking the browser's own pop-out.** BDOBB loads, frames, captures and retransmits nothing, and does not alter the page; the pop-out is the site's own control and the browser's own feature. Neither set of terms addresses moving or sizing a browser window. Versant's list bars surrounding content with third-party material, which is the closest wording to a video sitting inside a dashboard layout. Bloomberg's terms have no such clause; they bar framing, which the card does not do.
- **Volume.** The card operates the player's own volume control. Both sets of terms restrict automated tools that access or monitor the service; the wording is aimed at scraping but is broad.
- **Naming a site.** Both bar implying an association, and commercial use of the service. The card is therefore site-neutral: the source text is empty by default, and the card, its help pages and its tests name no site. This document names the sites only because the probe ran against them.
- **Not built, by decision:** simulating a click to pop the video out, which is automated operation of a site's page with no viewer action.
- **For the later automatic mute design:** CNBC's supplemental terms bar technology that automatically skips or deletes ads on recorded programmes, and Versant's list bars capturing content. A detector that reads the picture is the riskiest form; that design starts from these terms.
- **Use:** personal viewing only. CNBC+ access excludes public viewing spaces.

## Testing

- Frontend unit tests: each card state in the table, the built-in card definition, the minimum body size, the iPad reserved space (hint shown, no mute button), and the Windows and web placeholder.
- Native unit tests: screen-coordinate conversion; the 16:9 fit inside a rectangle including the size limits; the restore order for a player that was partly off-screen; mute bookkeeping (recorded level, "BDOBB muted it" flag); the step count between two slider values.
- Existing suites pass on desktop, iPad and web.
- Manual acceptance on the user's Mac with the real player, which is the acceptance gate: fit on first show; follow a card move, card resize, scroll and BDOBB window drag; restore on dashboard switch, card removal, minimise and quit, including a player that started partly off-screen; mute and unmute by ear, including after changing the volume in the player; permission denied; and each item in the "not verified" list above.
- No automated end-to-end test: CI cannot grant Accessibility permission or run Chrome with a live stream.

## Documentation

A help guide page for the card under `src/help/guide/` on the v8 line, following the existing pages.
