# Draft attachment keeper

Fixes a DSH bug: an image or file attached to the composer disappears when you
switch to another Session and come back, while the draft text survives.

## What happens inside DSH

- Pending attachments (the `File` object, its object-URL preview, and the
  in-flight upload) live in the root `conversation` service.
- The ids that point at them live in the Session's input shell.
- The input shell rides the Session scope, and the main view is the only
  reference that keeps that scope alive. Switching away drops the last
  reference, the scope retires, and the shell disposer releases every remaining
  draft attachment: the preview URL is revoked and the upload is aborted.
- Draft text looks unaffected because it is persisted to `localStorage`
  (`dsh.conversation.<sessionId>`); attachments are documented as browser-only
  and are never persisted.

## What this bundle does

While a Session's draft owns at least one attachment, the keeper retains that
Session under its own reference source (`draftKeep`). The reference count never
reaches zero during a switch, so the scope and its input shell stay alive and
the same shell is reused when you return. The pin is released as soon as the
last attachment is sent or removed.

## Limitations

- The pin covers browser attachments only. Reloading the page still drops
  pending attachments, because their bytes are never persisted.
- A Session left with an unsent attachment keeps its client scope alive until
  you send, remove, or reload. This is client memory only; no Host request is
  made on your behalf.
- The keeper wraps `conversation.createDrafts` and
  `conversation.releaseDraftAttachment` at runtime. If a future DSH release
  changes those methods, the bundle logs a warning and does nothing instead of
  breaking the composer.