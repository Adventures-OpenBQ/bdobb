<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Settings widgets — contract version 1

A service a backend runs can put its own section in BDOBB's **Settings**
dialog without any change to the app. It does so by advertising a
`type: "settings"` widget in the backend's `widgets.json`. This page is the
reference a service implements. First shipped in BDOBB v3.0.3.

## Advertising

One `widgets.json` entry per section:

    { "id": "rss_ticker_settings", "type": "settings", "name": "RSS ticker",
      "endpoint": "settings", "settings": { "ui": "form" } }

| `settings.ui` | Meaning |
|---|---|
| `"form"` | The app draws the section from what `GET {endpoint}` returns (below). |
| `{ "app": "<name>" }` | A UI the app ships. v3.0.3 knows `keys` only: it shows the provider-keys panel bound to the `keys` widget on the **same backend**. There is no section if that backend serves no `keys` widget. Any other name, and any `ui` this app does not recognise, shows "Needs a newer app version". |
| `{ "page": "<path>" }` | Reserved. v3.0.3 shows "Not supported in this version". |

- Settings widgets never appear in the widget library, and are never fetched as cards.
- Sections sit between Layout and Logs, sorted by backend name, then label (a Keys widget with no name sorts as "Provider API Keys").
- Every section, Keys included, is labelled with the widget's `name`. A Keys section whose widget has no name of its own is labelled "Provider API Keys". Two sections that would share a label each get their backend's name appended, for example "Provider API Keys (NAS)".
- Add `"raw": false` if the endpoint can return anything sensitive, so OpenBB Workspace offers no raw view of it. key-maint's settings entry does this.
- OpenBB Workspace ignores the type.

## Reading a form: `GET {endpoint}`

    { "version": 1, "title": "RSS ticker", "description": "…",
      "fields": [
        { "id": "poll_seconds", "label": "Poll interval", "type": "number",
          "value": 60, "min": 10, "max": 3600, "unit": "s", "help": "…",
          "readOnly": false, "readOnlyReason": null } ] }

- `title` and `description` are optional and default to empty. `label` is optional and defaults to the field's `id`. `help` and `readOnlyReason` are optional strings; `null` is treated as absent.
- `type` is one of the following. There is no secret type: do not put credentials in a form.
  - `text`, whose value is a string.
  - `number`, whose value is a finite number. Optional `min`, `max`, `step` and `unit`. `min` and `max` are hints only: the app does not enforce them, and the service's 422 is the authority.
  - `boolean`.
  - `select`, with a non-empty `options: [{ "value": …, "label": "…" }]`. Each option value is a string, number or boolean, and the field's value must be one of them. Option values go back with their JSON type.
- `readOnly: true` locks a field. Only the boolean `true` locks it; `"true"` or `1` do not. `readOnlyReason` is shown next to it.
- An unknown field `type` is shown read-only as text, with a note. It still needs an `id` and a `type` string, and it is never sent back.
- `version` greater than 1 shows "Needs a newer app version" and no fields.
- Anything else malformed is a section error with a Retry. It never takes the dialog down. That covers: a body that is not an object, a `version` that is not a number, no `fields` list, a field with no (or an empty) `id`, or no `type`, a known field whose value has the wrong type, a `select` with bad options, and a duplicate `id`.

## Writing a form: `PUT {endpoint}`

The body is `{ "values": { "<field id>": <value>, … } }`, carrying **the changed fields only**. A field the user edited back to its original value is not sent, and a save with nothing changed sends no request.

| Answer | App behaviour |
|---|---|
| **200** with the full section again, plus an optional `notice` string | Redraws from the body and shows the notice ("Takes effect on restart"). A 200 body the app cannot read (malformed, or a `version` above 1) is a section-level error and leaves the user's edits in place. |
| **422** with `{ "errors": { "<field id>": "<message>" } }` | Each message goes by its field. An `errors` id that matches no field is shown as a section-level message instead. The values stay as typed. Only string messages count. |
| Anything else, including a 422 without a usable `errors` | Section-level error. The fields keep the user's edits. |

## Auth and failure isolation

Reads and writes use the app's normal request path with the backend's
credentials: the same header, cookie or query placement as data fetches. A
service's settings are exactly as protected as its data.

When a service is unreachable, or answers a read with a non-2xx status,
only its own section shows the error and a Retry.

## Compatibility

A backend that serves the pre-v3.0.3 `type: "keys"` widget without a settings
entry still gets its Keys section, labelled with that widget's name (or "Provider
API Keys" if it has none). An app older than v3.0.3 ignores
`type: "settings"` entirely.
