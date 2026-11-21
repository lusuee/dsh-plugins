# Session files

A DSH Web GUI plugin that answers one question for a Session: **which files did
this conversation actually touch?**

It adds a **Files** tab next to Chat and Trajectory. The tab lists every file the
Session wrote, edited, or delivered, with search, state filters, per-file
badges, and one-click opening in the right sidebar preview.

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

## Usage

1. Open a Session.
2. Click **Files** in the conversation view tabs.
3. Search by name or path, filter by New / Edited / Delivered.
4. Click a row to preview the file in the right sidebar.
5. Use the copy button on a row (or **Copy all paths**) to grab paths.

## Files

```
package.json          package manifest (bundle + client entry)
cordis.patch.yml      bundle patch that inserts the plugin
lib/index.js          Host half: the `sessionFiles` Session projection
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