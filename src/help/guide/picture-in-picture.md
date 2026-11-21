---
type: Note
tags: [bdobb, help, widgets, built-in, picture-in-picture, video, chrome]
---

# Picture in Picture

The **Live TV** widget combines YouTube playback and incoming Chrome **Picture in Picture grab** in one card. Connect the companion RSS server as a backend, then add **Live TV**. Its **Channel** picker offers **YouTube - Bloomberg Live**, **YouTube - Schwab Network Live**, **YouTube - Yahoo Finance 24/7 Stream**, and **Picture in Picture grab**. A YouTube channel can be off-air and is reported as unavailable rather than silently playing a recording.

## Bringing Chrome's floating video into the card

On macOS or Windows, start a video in Chrome and pop it out with Chrome's picture-in-picture control. Choose **Picture in Picture grab** in the Live TV card's **Channel** picker. BDOBB uses the existing Chrome parking controller described below to fit the player over the card; Chrome keeps playing the video. Switching back to a YouTube source releases Chrome's player, including when the card is hidden.

The same choice works in a locked band: open **Settings ▸ Locked Widgets**, edit the top or bottom band, add **Live TV**, choose **Picture in Picture grab**, and choose **OK**. A locked card keeps its stored height. Make the band large enough for the player. Chrome's own controls operate playback and sound; Live TV's **Start muted** and **Autoplay** preferences apply to its YouTube sources.

The incoming Chrome grab works on macOS and Windows. macOS requires Accessibility permission. The iPadOS sandbox prevents moving another app's player; choose a YouTube source for inline playback instead.

## Live TV controls

Live TV opens with its parameter panel hidden. **Show parameters** reveals playback preferences. Its row 0 speaker button mutes or unmutes a YouTube stream; Chrome grab uses Chrome's own sound controls. Live TV has no outgoing Picture in Picture button. Older saved floating preferences return to inline playback.

## Other YouTube cards on macOS and Windows

On other YouTube video cards, choose **Picture in Picture** to move playback to BDOBB's own resizable, always-on-top player. Choose **Return video to card**, or close the floating window, to return inline. Only one player for that card is active at a time. A source change updates its floating player. Removing the card, changing dashboards or tabs, or quitting BDOBB closes it. A saved floating choice can reopen when you return to the card.

Open the card's **Parameters** panel to change **Start muted** and **Autoplay**. The playback choices are saved with the dashboard and travel in BDOBB workspace exports and dashboard sync; they are never sent to the data provider as query parameters. Autoplay can be restricted by YouTube or the platform; use the player's Play control when necessary. Returning a recorded video may restart it; this is intended for live streams, whose player resumes at the current live position.

On iPad, in a browser and on other platforms, the same card plays inline. iPad's sandbox prevents this desktop floating-player integration. A desktop PiP preference is retained without opening an unsupported window on iPad. Viewer windows also play inline. Locked cards can play video but do not expose writable playback configuration.

## Incoming Chrome grab on Windows

In **Live TV**, choose **Picture in Picture grab** after popping a video out in Chrome. Chrome and BDOBB must run as the same Windows user with the same privilege level. The grab uses Chrome's English **Picture in picture** window; other browser players and non-English window titles are not selected. Leave only one Chrome floating player open.

The player follows the card and BDOBB's window, parks while the card or app is hidden, and returns to its original position and size when released. Display scaling is applied to the card; restoring uses the original physical position after a display-scale change. If that display has been removed, the player returns within an available display instead. Use Chrome's own playback and sound controls. No Chrome-tab accessibility or volume-slider control is used by the combined grab.

If BDOBB is force-terminated while holding the player, close and reopen Chrome's floating player before grabbing it again. This prevents another app instance from taking over a window still marked as held. Normal release and quit remove that marker. The standalone legacy card's macOS-specific mute options remain separate.

## Legacy Chrome parking cards

Existing standalone **Picture in Picture** cards remain compatible. The placement, hiding and permission rules below also apply to Live TV's incoming Chrome grab. Source-title and mute-slider settings belong to the standalone card.

## On the Mac

1. Add **Picture in Picture** from the [[widget-library|Widget Library]]. It is under *Built-in*.
2. The first time, the card asks for **Accessibility** permission. Choose **Open Accessibility settings**, switch BDOBB on in *System Settings ▸ Privacy & Security ▸ Accessibility*, and come back. BDOBB uses the permission only to move, size and mute Chrome's floating player.
3. In Chrome, start the video and pop it out with its picture-in-picture button. Within a few seconds the player jumps onto the card.

The player follows the card when you move it, resize it, maximize it or scroll the dashboard, and when you drag BDOBB's window. It keeps the video's 16:9 shape and sits against the top of the card, centred left to right. Chrome will not make it smaller than 284 × 160 or larger than about 80% of the display (1388 × 781 on a 1736 × 1133 display). A card smaller than that says *Make this card at least 284 × 160 to park the player here*. A card partly scrolled out of view keeps the player, which may then overlap the header.

The card's height follows its width: whenever you resize the card, it snaps to the fewest rows that hold the video at the card's width, so the video resizes with the width and under one row of space is left below it. Dragging a corner changes the height only until you let go, when it snaps back to fit the video. Opening the card's **Parameters** panel makes the card taller by the panel's height, so the video keeps its room, and closing it gives the rows back.

## Hiding

When the card cannot be seen, BDOBB moves the player off screen and brings it back when the card returns. This happens when the card is scrolled fully out of view, when you switch to another dashboard or tab, when you minimize the card (its `—` button), when you minimize BDOBB, and when another app is in front. Clicking the player's own controls does not count as leaving BDOBB. Opening the card's own **⋯** menu also moves the player aside, so it does not cover the menu, and it comes back when the menu closes. So does opening any dialog, such as **Settings**: Chrome's player floats above every window and would cover the dialog, so it stays away until the last dialog closes.

Removing the card, or quitting BDOBB, puts Chrome's player back where it was, at its old size. So does a card made smaller than 284 × 160. If BDOBB crashes, the player stays where BDOBB last put it. If it crashed while **Mute while hidden** had the sound off, the next time BDOBB runs it turns the sound back up to where it was, whether or not the card is in view then. It does this only if BDOBB last ran within a day, the card's two mute settings are unchanged, and you have not changed the volume yourself.

## Mute

The 🔊 button in the card's header mutes the stream, and 🔇 turns it back on at the volume it had. BDOBB does this by stepping the video's own **Volume Level** slider in the Chrome tab the video came from, so the button stays right when you change the volume in the player yourself. Two settings in the card's parameters find that tab and slider, and a third decides whether hiding mutes:

- **Source tab title contains**: optional text in the tab's title. Leave it empty and BDOBB uses whichever Chrome window shows the slider; fill it in when more than one open tab has a player.
- **Volume slider label**: what the site calls its slider. The default is `Volume Level`. Change it only if the site renames the control.
- **Mute while hidden**: *Off* by default. Set to *On*, the volume goes to 0 while the player is hidden and returns to its level when the player comes back. If you had already muted the video, it stays muted. Opening the card's menu or a dialog never mutes.

Chrome shows BDOBB only the selected tab of each window. If the stream's tab is not the selected tab in its window, the button is dimmed, and hovering over it says why. The player still parks either way. When BDOBB puts the player back where it was, it also turns the volume back up if BDOBB was the one that muted it.

## What the card says

| Card says | Meaning |
| --- | --- |
| *Pop the video out in Chrome* | No floating player is open; the card checks again every few seconds |
| *The player is in use by another card* | Another Picture in Picture card holds it; remove that card or scroll it away |
| *Chrome's player cannot follow BDOBB into full screen* | BDOBB is in macOS full screen, which is a desktop of its own that Chrome's floating player does not join. The player is moved off screen until you leave full screen. To make BDOBB large without full screen, hold Option and click the green button, which zooms the window on the same desktop |
| *Open this dashboard in the main window* | The card is in an **Open in new window** viewer, which cannot hold the player |
| *BDOBB needs Accessibility permission…* | See step 2 above |

## On iPad, Windows, Linux and the web preview

On iPad the card is an empty space with the hint *Park a picture-in-picture video here*. iPadOS gives an app no way to move another app's player, so drag the picture-in-picture video onto the card yourself. There is no mute button on iPad. Windows supports Chrome player placement as described above, with Chrome's own audio controls. Linux and the [[web-preview|Web Preview]] show *Available in the macOS desktop app*.

## Limits

Chrome only, and only its one floating player. The player does not show while BDOBB is in macOS full screen. The window title BDOBB looks for is the English `Picture in Picture`, so a Chrome set to another language is not yet supported. The card does not crop the video, detect commercial breaks, or pop the video out for you.

*See also: [[built-in-widgets|Built-in Widgets]] · [[widget-cards|Widget Cards]] · [[live-tv|Live TV]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
