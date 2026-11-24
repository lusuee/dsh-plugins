# Session files

## The question it answers

Every Session leaves a trail of files behind: notes that were written, config
that was edited, a screenshot that was delivered. Reconstructing that trail from
the transcript means scrolling through tool calls. **Files** collects it once and
keeps it current for the whole Session.

The tab sits beside Chat and Trajectory and is scoped to the Session you are
looking at. It survives reloads, reconnects, and extra browser tabs, because the
answer is computed on the Host and streamed to every client.

## What counts as a file

| Source | Appears as | Notes |
| --- | --- | --- |
| `write` | **New** on first sight, **Edited** after | first appearance implies creation |
| `edit` | **Edited** | patches that add, change, or remove text |
| `str_replace_editor` | **New** for `create`, **Edited** otherwise | the three supported commands |
| `present` | **Delivered** | also adds files the Session never wrote |

An entry keeps the turn that last touched it and merges repeated writes to the
same path into one row, so a file edited ten times is listed once with the
latest turn.

## Reading the list

- **Search** matches the file name, directory, and delivery description.
- **Filters** narrow the list to New, Edited, or Delivered; the counters on each
  filter show how many rows it would reveal.
- **Row badges** use a colored dot plus a word, so state is readable without
  relying on color: blue = new, amber = edited, green = delivered.
- **Click a row** to open the file in the right sidebar preview without leaving
  the conversation.
- **Copy** grabs one path; **Copy all paths** grabs the whole Session's list,
  one absolute path per line, ready for a shell.

Rows are ordered by most recent touch. The extension chip on the left is colored
by file family (code, documents, images, data), which makes large lists faster to
scan.

## Recycling a file

The trash button on a row asks the Host to move the file to the system recycle
bin. The request is checked against the Session's own file index, so the button
cannot reach a path this conversation never produced, and the target must be a
regular file — directories and missing files are refused before anything moves.

If the recycle bin cannot be written, the file is renamed into a same-volume
`.trash/<timestamp>/` directory next to it, and a `.rm-safe-manifest.json` records
the original path, time, and reason. That fallback exists because DSH runs tool
processes at low integrity on Windows, where the recycle bin can silently refuse
the move; the plugin never degrades into a permanent delete.

After a successful recycle the row stays in the list — the event log still
mentions the file — but this browser tab marks it **Recycled** and stops opening
it. The mark lives in the tab's session storage, so a reload keeps it while a
different browser tab still sees the file as before.

## Boundaries

The list is intentionally limited to files a tool result can prove:

- shell commands, builds, and formatters that write files are invisible unless
  the Session explicitly delivers the result with `present`;
- files changed in git without going through a tracked tool are invisible;
- files touched by other Sessions, or by you outside the conversation, are
  invisible;
- the `apply_patch` variant is not counted; it reports ranges rather than files
  and cannot reliably distinguish new files from edits.

These are the same limits the built-in changed-files card has. Treat the tab as
"what this conversation is doing", not as a filesystem audit.

## How it works

The Host half registers a Session projection named `sessionFiles`. A projection
replays the committed event log, folds `tool/call`, `tool/result`, and
`deliverables/presented` into one state, and publishes only the derived
`{ cwd, files }` view. The browser half reads that view through
`useProjection("sessionFiles")` and never parses raw events itself.

Because the fold is Host-side:

- reloading the Web GUI re-renders the same list from the same log;
- two clients on the same Session see the same entries;
- the plugin stores no files of its own and sends no content anywhere — only
  paths, states, turns, and delivered descriptions.

Opening a file builds the sidebar's standard file address for the Session, so the
preview behaves exactly like a file link in the transcript.

## Compatibility

Built for DSH `>=0.2.1-rc.3`, Web GUI only. If the sidebar service is missing,
the list still works and clicking a row shows a short message instead of opening
a preview. Host code is loaded once per app start, so updating the plugin
requires restarting the desktop app; the browser half picks up changes on a page
reload.