# Session files

A DSH Web GUI plugin that answers one question for a Session: **which files did
this conversation actually touch?**

It adds a **Files** tab next to Chat and Trajectory. The tab lists every file the
Session wrote, edited, or delivered, with search, state filters, per-file
badges, one-click opening in the right sidebar preview, and a **Recycle** action
that moves a file to the trash without ever deleting it permanently.

## What is collected

The list is built from the Session event log on the Host, not by watching the
filesystem:

- successful `write` calls (a first appearance counts as **new**);
- successful `edit` and `str_replace_editor` calls (**edited**);
- `deliverables/presented` entries from the `present` tool (**delivered**,
  including files the Session did not create itself).

Paths are canonicalized to the absolute path the tool reported, deduplicated
across the Session, and tagged with the turn that last touched them.

## What is not collected

- files created by shell commands, builds, or formatters without a delivered
  `present` call;
- git changes that were never written through a tracked tool;
- files modified by another Session or by the user outside this conversation.

The built-in changed-files card has the same boundary: the Host can only name a
file when a tool result proves it.

## Recycling

The trash button on a row asks the Host to move that file to the system recycle
bin. The Host refuses any path the Session did not produce and any path that is
not a regular file. When the recycle bin cannot be written, the file is moved to
a same-volume `.trash/<timestamp>/` quarantine next to it, with a
`.rm-safe-manifest.json` recording where it came from. Nothing is permanently
deleted, and wildcard paths are refused.

## Usage

1. Open a Session.
2. Click **Files** in the conversation view tabs.
3. Search by name or path, filter by New / Edited / Delivered.
4. Click a row to preview the file in the right sidebar.
5. Use the copy button on a row (or **Copy all paths**) to grab paths.
6. Use the trash button to recycle a file this Session produced; the row stays
   listed, marked **Recycled**.

## Files

```
package.json          package manifest (bundle + client entry)
cordis.patch.yml      bundle patch that inserts the plugin
lib/index.js          Host half: `sessionFiles` projection + recycle route
lib/client.js         Browser half: the Files tab (`conversation.view`)
locale/{en,zh}.json   display title, description, detail page
docs/DETAIL*.md       user-facing documentation
icon.svg              plugin icon
```

## Install

Installed as a local bundle through the profile:

```
plugin_manager install_bundle <absolute path to this package>
```

The bundle patch mounts the package; no profile files are edited by hand.