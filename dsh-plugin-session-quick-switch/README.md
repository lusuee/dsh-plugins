# dsh-plugin-session-quick-switch

A **Ctrl+E** palette for DSH — like VS Code's quick open, but for sessions.
On macOS the same command is **⌘E**.

Press `Ctrl+E` / `⌘E` anywhere in the Web GUI (composer focus included) and a
frame-wide palette drops down: **running sessions are pinned at the top**,
everything else follows by recency. Type to filter by title or folder, `↑`/`↓`
to move, `Enter` to open, `Esc` or a click outside to close. Pressing the
shortcut again closes it.

## Why

The sidebar lists sessions per workspace, so with several workspaces in flight
you scroll to find "which one is still working". DSH has no built-in
"running only" view; the closest built-in options are the sidebar's single-list
grouping and `Ctrl+K` session search. This plugin adds the missing one-key jump.

## What it does

- `shell.overlay` slot entry (`session-quick-switch`): a dialog layer over the
  whole frame, click-through when closed (it renders nothing then).
- Keyboard command `session-quick-switch.open`:
  - **Desktop** (macOS, Windows, Linux): `⌘E` / `Ctrl+E`.
  - **Web** (browser UI): `⌘⌥E` / `Ctrl+Alt+E`, because the bare chord belongs to
    the browser there (`Cmd+E` is "use selection for find" in Safari and Chrome).
    Linux browsers stay unbound on purpose: a Web binding on Linux must be one of
    the three combinations DSH admits (⌘/, ⌘⇧, ⌘⇧.), and a registration validates
    every declared profile, so an inadmissible default would fail the command on
    every platform. Rebind it in *Settings → Keyboard*.
- Layout is platform-aware: the layer keeps a floor above
  `--dsh-frame-top-clearance`, so on macOS the panel never sits under the
  traffic lights; type is drawn with macOS font smoothing and an explicit UI
  stack (`-apple-system` → `PingFang SC` for Chinese).
- Ordering: the framework's live `useSessionStatus` decides, with three groups —
  **Needs you** (the session is asking for an approval, a plan review or an answer;
  the same three kinds the sidebar surfaces, so a subagent-internal request stays
  in Running), **Running**, then **Recent**. Inside a group, newest `updatedAt`
  first; a finished-but-unread session (`completionUnread`) sorts ahead of plain
  idle ones. Subagent rows and blank "New Session" placeholders are skipped.
- Status dots: amber pulse = waiting on you, green pulse = still working, hollow
  blue ring = finished and not yet read, grey = idle.
- Presentation: a top-anchored dialog with a soft drop shadow, sticky group
  headers carrying their counts, the matched part of the title/folder tinted, and
  `kbd` chips in the footer. All colour comes from `--dsw-alias-*` tokens (each
  with a literal fallback), the font from an explicit UI stack, and motion is
  disabled under `prefers-reduced-motion`.
- The footer always says how many rows match, and the open palette re-reads the
  clock every 30 s so "just now" keeps ageing.
- Opening a session is `uiWorkspace.openSession(id)` — the same navigation the
  sidebar performs, so it just swaps the main view. The palette closes in the
  click's commit and the swap runs on the next frame: otherwise React batches both
  stores into one commit and the palette's disappearance waits behind mounting the
  target transcript, which reads as a frozen frame rather than a jump.
- Opening asks `sessions.refresh()` for a fresh list at most once a minute: a full
  projection pass landing next to a pick re-renders every workspace and is the one
  piece of that path the plugin owns.

No Host storage, no RPC, no new endpoints. No Harness Client package is
imported (`primitives` included): the palette is plain `react` plus theme tokens.

## Install (from source)

```powershell
# Windows: in the profile you use, with the package's absolute directory
dsh plugin --profile desktop add link:D:\dsh\plugins\dsh-plugin-session-quick-switch
```

```bash
# macOS / Linux: same package, POSIX path
dsh plugin --profile desktop add link:$HOME/dsh/plugins/dsh-plugin-session-quick-switch
```

or, from an agent, `plugin_manager` → `install_bundle` → `target` = that
absolute directory. Reload the Web GUI afterwards: the browser bundle is handed
over by the client's authenticated `loadBundle` transport (an anonymous
`GET /plugins/<id>/client.js` is a 404 by design), so a page reload is what picks
it up.

Requires DSH `>= 0.2.1-rc.3`.

## Tests

```powershell
node test/test-client.mjs
```

Loads `lib/client.js` under a fake module loader (no browser, no React, no
Host) and asserts the published surface — slot entry id/name/order, locale
namespace with matching `zh`/`en` keys, the shortcut command's id, per-platform
defaults, regions and `resolve()` toggle — plus the pure ordering rule
(`buildRows`: waiting → running → recent, live state over list flag, unread ahead
of idle, the pending-kind whitelist), the row states, and a smoke render of the
closed, open and empty palette.

## Files

| Path | Role |
| --- | --- |
| `lib/client.js` | The browser half: palette component, keyboard command, locale dictionaries. |
| `lib/index.js` | Host half: intentionally empty; its only job is to be a mounted package. |
| `cordis.patch.yml` | Bundle patch that inserts the Host row. |
| `test/test-client.mjs` | Offline harness described above. |

## Known limits

- Running detection is the framework's own status map, so a session the client
  has never observed falls back to the host list flag.
- The palette lists at most 30 idle sessions (running ones are never truncated).
  With no filter typed it scans the first 200 rows of the host list; a typed
  filter searches the whole list.
- The shortcut takes the chord above at the same profile level (desktop
  `⌘E`/`Ctrl+E`, web `⌘⌥E`/`Ctrl+Alt+E`). Registration validates every declared
  profile at once, so if a future DSH release or another plugin already owns one
  of those chords, `register` throws: the palette still mounts, the console warns
  with the rejected command, and the chord does nothing until you rebind it in
  *Settings → Keyboard*.
- The command is armed in the `page` and `editable` regions only, so it fires
  with the composer focused but stays out of the terminal, where `Ctrl+E` is
  readline's end-of-line.
