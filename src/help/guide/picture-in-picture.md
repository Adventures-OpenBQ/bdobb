---
type: Note
tags: [bdobb, help, widgets, built-in, picture-in-picture, video, chrome]
---

# Picture in Picture

**Picture in Picture** is a built-in card that keeps a place on a dashboard for a live video you are watching in Chrome. For example, you can park a Federal Reserve press conference video. BDOBB never loads or frames the stream. Chrome plays it in its own floating `Picture in Picture` window, and on the Mac BDOBB moves and sizes that window to sit exactly over the card. The floating window stays above every other window, so the video keeps playing over the card while you work.

## On the Mac

1. Add **Picture in Picture** from the [[widget-library|Widget Library]]. It is under *Built-in*.
2. The first time, the card asks for **Accessibility** permission. Choose **Open Accessibility settings**, switch BDOBB on in *System Settings ▸ Privacy & Security ▸ Accessibility*, and come back. BDOBB uses the permission only to move, size and mute Chrome's floating player.
3. In Chrome, start the video and pop it out with its picture-in-picture button. Within a few seconds the player jumps onto the card.

The player follows the card when you move it, resize it, maximize it or scroll the dashboard, and when you drag BDOBB's window. It keeps the video's 16:9 shape and sits against the top of the card, centred left to right. Chrome will not make it smaller than 284 × 160 or larger than about 80% of the display (1388 × 781 on a 1736 × 1133 display). A card smaller than that says *Make this card at least 284 × 160 to park the player here*. A card partly scrolled out of view keeps the player, which may then overlap the header.

If the card is wider than the video is tall, the player leaves empty space under it. Drag the handle on the card's bottom edge to trim the card to the video. The corner handles still work.

## Hiding

When the card cannot be seen, BDOBB moves the player off screen and brings it back when the card returns. This happens when the card is scrolled fully out of view, when you switch to another dashboard or tab, when you minimize the card (its `—` button), when you minimize BDOBB, and when another app is in front. Clicking the player's own controls does not count as leaving BDOBB. Opening the card's own **⋯** menu also moves the player aside, so it does not cover the menu, and it comes back when the menu closes.

Removing the card, or quitting BDOBB, puts Chrome's player back where it was, at its old size. So does a card made smaller than 284 × 160. If BDOBB crashes, the player stays where BDOBB last put it.

## Mute

The 🔊 button in the card's header mutes the stream, and 🔇 turns it back on at the volume it had. BDOBB does this by stepping the video's own **Volume Level** slider in the Chrome tab the video came from, so the button stays right when you change the volume in the player yourself. Two settings in the card's parameters find that tab and slider, and a third decides whether hiding mutes:

- **Source tab title contains**: optional text in the tab's title. Leave it empty and BDOBB uses whichever Chrome window shows the slider; fill it in when more than one open tab has a player.
- **Volume slider label**: what the site calls its slider. The default is `Volume Level`. Change it only if the site renames the control.
- **Mute while hidden**: *Off* by default. Set to *On*, the volume goes to 0 while the player is hidden and returns to its level when the player comes back. If you had already muted the video, it stays muted. Opening the card's menu never mutes.

Chrome shows BDOBB only the selected tab of each window. If the stream's tab is not the selected tab in its window, the button is dimmed, and hovering over it says why. The player still parks either way. When BDOBB puts the player back where it was, it also turns the volume back up if BDOBB was the one that muted it.

## What the card says

| Card says | Meaning |
| --- | --- |
| *Pop the video out in Chrome* | No floating player is open; the card checks again every few seconds |
| *The player is in use by another card* | Another Picture in Picture card holds it; remove that card or scroll it away |
| *Open this dashboard in the main window* | The card is in an **Open in new window** viewer, which cannot hold the player |
| *BDOBB needs Accessibility permission…* | See step 2 above |

## On iPad, Windows, Linux and the web preview

On iPad the card is an empty space with the hint *Park a picture-in-picture video here*. iPadOS gives an app no way to move another app's player, so drag the picture-in-picture video onto the card yourself. There is no mute button on iPad. The Windows app, Linux and the [[web-preview|Web Preview]] show *Available in the macOS desktop app*.

## Limits

Chrome only, and only its one floating player. The window title BDOBB looks for is the English `Picture in Picture`, so a Chrome set to another language is not yet supported. The card does not crop the video, detect commercial breaks, or pop the video out for you.

*See also: [[built-in-widgets|Built-in Widgets]] · [[widget-cards|Widget Cards]] · [[live-tv|Live TV]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
