/**
 * Client half: keep pending composer attachments alive when the user switches
 * Sessions before sending.
 *
 * Root cause this works around: browser-owned draft attachments live in the
 * root `conversation` service, but the input shell that holds their ids is
 * disposed together with the Session scope. The only reference a Session keeps
 * while it is on screen is `mainView`; switching away drops it, the reference
 * count reaches zero, the scope retires, the shell is torn down, and the shell
 * disposer releases every remaining draft attachment (revoking the image
 * preview and aborting its upload). Draft text survives because it is written
 * to localStorage, which is why only attachments disappear.
 *
 * The keeper adds one extra reference source (`draftKeep`) for a Session while
 * that Session's draft owns at least one browser attachment. The scope then
 * stays alive across the switch, the same shell is reused on return, and no
 * attachment is ever released by a teardown.
 */
window.__ModuleLoader__.load({
  id: '@local/draft-attachment-keeper',
  factory(require) {
    const SOURCE = 'draftKeep'
    const TAG = '[draft-attachment-keeper]'

    return {
      inject: ['conversation', 'sessions'],
      apply(ctx) {
        const conversation = ctx.get('conversation')
        const sessions = ctx.get('sessions')
        if (conversation === undefined || sessions === undefined) return
        if (typeof conversation.createDrafts !== 'function'
          || typeof conversation.releaseDraftAttachment !== 'function'
          || typeof sessions.retain !== 'function') {
          console.warn(`${TAG} conversation attachment API changed; keeper inactive`)
          return
        }

        /** Live attachment count per owning Session. */
        const counts = new Map()
        /** Held Session reference per pinned Session. */
        const holds = new Map()
        /** Owning Session of each live browser attachment id. */
        const owners = new Map()

        const hold = (sessionId) => {
          if (holds.has(sessionId)) return
          try {
            holds.set(sessionId, sessions.retain(sessionId, { source: SOURCE }))
          } catch (error) {
            console.warn(`${TAG} could not retain session "${sessionId}":`, error)
          }
        }

        const drop = (sessionId) => {
          const reference = holds.get(sessionId)
          if (reference === undefined) return
          holds.delete(sessionId)
          try {
            reference.release()
          } catch (error) {
            console.warn(`${TAG} release failed for session "${sessionId}":`, error)
          }
        }

        const bump = (sessionId, delta) => {
          const next = (counts.get(sessionId) || 0) + delta
          if (next <= 0) {
            counts.delete(sessionId)
            drop(sessionId)
            return
          }
          counts.set(sessionId, next)
          hold(sessionId)
        }

        const createDraftsOriginal = conversation.createDrafts
        const createDrafts = createDraftsOriginal.bind(conversation)
        conversation.createDrafts = (sessionId, files, uploadImages) => {
          const created = createDrafts(sessionId, files, uploadImages)
          for (const attachment of created) {
            if (attachment === undefined || attachment.id === undefined) continue
            owners.set(attachment.id, sessionId)
            bump(sessionId, 1)
          }
          return created
        }

        const releaseOriginal = conversation.releaseDraftAttachment
        const releaseDraftAttachment = releaseOriginal.bind(conversation)
        conversation.releaseDraftAttachment = (attachmentId) => {
          const sessionId = owners.get(attachmentId)
          releaseDraftAttachment(attachmentId)
          if (sessionId === undefined) return
          owners.delete(attachmentId)
          bump(sessionId, -1)
        }

        globalThis.__draftAttachmentKeeper = {
          active: true,
          source: SOURCE,
          pinned: () => [...holds.keys()],
          counts: () => Object.fromEntries(counts),
        }
        console.info(`${TAG} active — a Session with a pending attachment keeps its scope`)

        ctx.effect(() => () => {
          conversation.createDrafts = createDraftsOriginal
          conversation.releaseDraftAttachment = releaseOriginal
          for (const reference of holds.values()) {
            try {
              reference.release()
            } catch {
              // A disposed controller already released its references.
            }
          }
          holds.clear()
          counts.clear()
          owners.clear()
          globalThis.__draftAttachmentKeeper = { active: false, source: SOURCE }
        }, 'draft-attachment-keeper: attachment hooks')
      },
    }
  },
})