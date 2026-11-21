/**
 * Host half of `dsh-plugin-session-files`.
 *
 * One job: fold the Session event log into a single session-scoped list of the
 * files this Session wrote, edited, or delivered. The fold is a
 * `sessionProjections` unit, so the Host owns the authoritative answer: it
 * replays the committed log, survives reconnects, and the browser only renders
 * what the Host published.
 *
 * Tracked inputs (the same three sources the built-in deliverables card uses):
 *
 * - successful `write` / `edit` / `str_replace_editor` tool calls whose result
 *   carries an absolute workspace path in its presentation `meta.path`;
 * - `deliverables/presented` events, where a tool explicitly delivers a file;
 *
 * Files a tool creates without either signal (a shell redirect, a build
 * artifact, a git change) are deliberately out of scope: the Host cannot know
 * whether touching a path produced a file the user wants listed, and guessing
 * would surface every temporary file a command happened to write.
 *
 * @module dsh-plugin-session-files
 */

/** Stable Loader identity. */
export const name = 'dsh-plugin-session-files'

/** Client-visible projection key; the browser half reads exactly this key. */
const KEY = 'sessionFiles'

/** Fold schema version: bump when the event interpretation changes. */
const STATE_VERSION = 1

/** Host tools whose successful result is a file mutation we can name. */
const MUTATION_TOOLS = new Set(['write', 'edit', 'str_replace_editor'])

/** Duck-typed schema: the registry only ever calls `.parse`, and our states are already plain JSON. */
const PASS_THROUGH = { parse(value) { return value } }

/** @param value - any value. @returns whether it is a non-null, non-array object. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @param value - any value. @returns the string, or '' when it is not one. */
function textOf(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * A path argument worth keeping: a string that is not only whitespace.
 * @param value - raw argument value.
 * @returns the original string, or undefined.
 */
function pathValue(value) {
  if (typeof value !== 'string') return undefined
  return value.trim() === '' ? undefined : value
}

/**
 * Whether a path is absolute in the Host workspace's sense.
 * @param path - a `/`- or `\`-separated path.
 * @returns whether it starts with `/`, a Windows drive, or a UNC prefix.
 */
function isAbsolutePath(path) {
  if (typeof path !== 'string' || path === '') return false
  return path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
}

/**
 * Normalize separators and drop leading `./` segments, keeping the rest intact.
 * @param path - raw path.
 * @returns the display path, with `/` separators.
 */
function normalizePath(path) {
  return path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
}

/**
 * Whether paths from this workspace are case-insensitive (Windows).
 * @param cwd - the Session working directory, already normalized, or ''.
 * @returns whether file keys fold to lower case.
 */
function foldsCase(cwd) {
  return /^[A-Za-z]:\//.test(cwd) || cwd.startsWith('//')
}

/**
 * Resolve a tool path against the Session working directory when it is relative.
 * @param cwd - normalized Session working directory, or ''.
 * @param candidate - the path as the model passed it.
 * @returns the normalized absolute path, or undefined when it cannot be resolved.
 */
function resolvePath(cwd, candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return undefined
  if (isAbsolutePath(candidate)) return normalizePath(candidate)
  if (cwd === '' || !isAbsolutePath(cwd)) return undefined
  const base = cwd.replace(/\/+$/, '')
  return normalizePath(`${base}/${candidate}`)
}

/**
 * Parse the raw tool-call arguments the model produced.
 * @param raw - the `arguments` JSON string.
 * @returns the object when it parses to one, else undefined.
 */
function parseArguments(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * The path and mutation mode of a supported tool call, using the same argument
 * rules as the built-in deliverables card (a call that would have failed
 * validation there is not a mutation here either).
 * @param name - tool name.
 * @param args - parsed arguments.
 * @returns `{ path, mode }`, where mode is `create`, `write`, or `edit`, or undefined.
 */
function mutationOf(name, args) {
  if (!isRecord(args)) return undefined
  if (name === 'write') {
    if (typeof args.content !== 'string') return undefined
    return { path: pathValue(args.file_path), mode: 'write' }
  }
  if (name === 'edit') {
    const before = args.old_string
    const after = args.new_string
    if (typeof before !== 'string' || before === '') return undefined
    if (typeof after !== 'string' || after === before) return undefined
    if (args.replace_all !== undefined && typeof args.replace_all !== 'boolean') return undefined
    return { path: pathValue(args.file_path), mode: 'edit' }
  }
  if (name === 'str_replace_editor') {
    const command = args.command
    if (command === 'create') {
      if (typeof args.file_text !== 'string') return undefined
      return { path: pathValue(args.path), mode: 'create' }
    }
    if (command === 'str_replace') {
      if (typeof args.old_str !== 'string' || args.old_str === '') return undefined
      if (args.new_str !== undefined && typeof args.new_str !== 'string') return undefined
      return { path: pathValue(args.path), mode: 'edit' }
    }
    if (command === 'insert') {
      if (typeof args.insert_line !== 'number' || !Number.isInteger(args.insert_line) || args.insert_line < 0) return undefined
      if (typeof args.new_str !== 'string') return undefined
      return { path: pathValue(args.path), mode: 'edit' }
    }
    return undefined
  }
  return undefined
}

/**
 * The file path a successful mutation result names. `meta.path` is the tool's
 * canonical absolute path and wins; otherwise the argument path is used only
 * when it is already absolute, matching the deliverables card's rule.
 * @param cwd - normalized Session working directory.
 * @param argumentPath - the path recorded at call time.
 * @param meta - the tool result's presentation meta.
 * @returns the resolved normalized path, or undefined.
 */
function resultPath(cwd, argumentPath, meta) {
  if (isRecord(meta)) {
    const canonical = meta.path
    if (typeof canonical === 'string' && isAbsolutePath(canonical)) return normalizePath(canonical)
  }
  return resolvePath(cwd, argumentPath)
}

/**
 * Read the mutation mode a result reports, falling back to the call's own mode.
 * `write`'s meta distinguishes create from update; `edit` has no operation.
 * @param meta - the tool result's presentation meta.
 * @param fallback - the mode recorded at call time.
 * @returns `create`, `write`, or `edit`.
 */
function resultMode(meta, fallback) {
  if (isRecord(meta) && meta.operation === 'create') return 'create'
  if (isRecord(meta) && meta.operation === 'update') return 'edit'
  return fallback
}

/**
 * Replace the state's published view with one built from its current fields.
 * The view object only changes when the file list or working directory changes,
 * so unrelated events never republish the same payload.
 * @param state - a state whose files or cwd changed.
 * @returns a new state carrying a fresh view.
 */
function relisted(state) {
  return { ...state, view: { cwd: state.cwd, files: state.files } }
}

/**
 * Add or update one file entry.
 * @param state - current fold state.
 * @param path - normalized absolute path.
 * @param mode - `create`, `write`, or `edit`.
 * @param turn - the event's turn.
 * @param seq - the event's sequence number.
 * @param description - an optional delivered-file description (present events).
 * @returns the new state.
 */
function withFile(state, path, mode, turn, seq, description) {
  const key = state.foldCase ? path.toLowerCase() : path
  const at = state.index[key]
  if (at === undefined) {
    // `write` cannot tell create from update on its own; a first appearance
    // through write is a creation far more often than not, while a first
    // appearance through edit is explicitly an update.
    const created = mode === 'create' || mode === 'write'
    const entry = {
      path,
      firstTurn: turn,
      lastTurn: turn,
      seq,
      created,
      edited: !created,
      presented: description !== undefined,
    }
    if (description !== undefined) entry.description = description
    const files = state.files.concat([entry])
    const index = { ...state.index, [key]: files.length - 1 }
    return relisted({ ...state, files, index })
  }
  const previous = state.files[at]
  const entry = {
    ...previous,
    lastTurn: turn,
    seq,
    created: previous.created === true || mode === 'create',
    edited: previous.edited === true || mode !== 'create',
  }
  if (description !== undefined) {
    entry.presented = true
    entry.description = description
  }
  const files = state.files.slice()
  files[at] = entry
  return relisted({ ...state, files })
}

/**
 * Mark one delivered file, adding it when the Session never wrote it (a
 * screenshot or a produced artifact is delivered without a mutation).
 * @param state - current fold state.
 * @param path - normalized absolute path.
 * @param turn - the present event's turn.
 * @param seq - the present event's sequence number.
 * @param description - the delivered-file description, when one was given.
 * @returns the new state.
 */
function withPresented(state, path, turn, seq, description) {
  const key = state.foldCase ? path.toLowerCase() : path
  const at = state.index[key]
  if (at === undefined) {
    const entry = {
      path,
      firstTurn: turn,
      lastTurn: turn,
      seq,
      created: false,
      edited: false,
      presented: true,
    }
    if (description !== undefined) entry.description = description
    const files = state.files.concat([entry])
    const index = { ...state.index, [key]: files.length - 1 }
    return relisted({ ...state, files, index })
  }
  const previous = state.files[at]
  const entry = { ...previous, lastTurn: turn, seq, presented: true }
  if (description !== undefined) entry.description = description
  const files = state.files.slice()
  files[at] = entry
  return relisted({ ...state, files })
}

/** The client-visible projection definition. */
const DEFINITION = {
  key: KEY,
  stateVersion: STATE_VERSION,
  stateSchema: PASS_THROUGH,
  /**
   * Start empty with the Session working directory, which later paths resolve against.
   * @param header - the Session header.
   * @returns the initial fold state.
   */
  init(header) {
    const cwd = normalizePath(textOf(header?.cwd))
    const files = []
    return { cwd, foldCase: foldsCase(cwd), files, calls: {}, index: {}, view: { cwd, files } }
  },
  /**
   * Fold one committed event. Every unrelated event returns the same state
   * reference, so the projection never republishes unchanged data.
   * @param state - current fold state.
   * @param event - one committed Session event.
   * @returns the next state.
   */
  apply(state, event) {
    if (!isRecord(event) || !isRecord(event.data)) return state
    if (event.type === 'tool/call') {
      const data = event.data
      if (!MUTATION_TOOLS.has(data.name)) return state
      const mutation = mutationOf(data.name, parseArguments(data.arguments))
      if (mutation === undefined || mutation.path === undefined) return state
      const resolved = resolvePath(state.cwd, mutation.path)
      if (resolved === undefined) return state
      const calls = { ...state.calls }
      calls[data.callId] = { path: resolved, mode: mutation.mode, turn: data.turn }
      return { ...state, calls }
    }
    if (event.type === 'tool/result') {
      const data = event.data
      const message = data.message
      const callId = isRecord(message) && isRecord(message.source) ? message.source.callId : undefined
      if (typeof callId !== 'string' || state.calls[callId] === undefined) return state
      const pending = state.calls[callId]
      const calls = { ...state.calls }
      delete calls[callId]
      const next = { ...state, calls }
      if (message.isError === true) return next
      const path = resultPath(next.cwd, pending.path, data.meta)
      if (path === undefined) return next
      return withFile(next, path, resultMode(data.meta, pending.mode), data.turn, event.seq, undefined)
    }
    if (event.type === 'deliverables/presented') {
      const data = event.data
      if (!Array.isArray(data.files) || data.files.length === 0) return state
      let next = state
      for (const file of data.files) {
        if (!isRecord(file)) continue
        const path = resolvePath(next.cwd, file.path)
        if (path === undefined) continue
        const description = typeof file.description === 'string' && file.description.trim() !== '' ? file.description : undefined
        next = withPresented(next, path, data.turn, event.seq, description)
      }
      return next
    }
    return state
  },
  wire: {
    viewSchema: PASS_THROUGH,
    view(state) {
      return state.view
    },
    // A long file list is not Session-list preview material.
    summary: false,
  },
}

/** Host plugin body: register the fold on the calling fiber. */
export const inject = ['sessionProjections']

/**
 * @param ctx - Host context carrying the projection registry.
 */
export function apply(ctx) {
  ctx.effect(() => {
    let registration
    try {
      registration = ctx.sessionProjections.register(DEFINITION)
    } catch (error) {
      // A duplicate key with a conflicting schema is the only synchronous
      // failure; the rest of the GUI must still load, so this stays a warning.
      ctx.logger.warn('session-files: projection registration rejected: %s', String(error))
      return () => {}
    }
    // The registry reports asynchronous registration failures through the
    // thenable; observing it here replaces the registry's own late warning.
    try {
      registration.catch((error) => {
        ctx.logger.warn('session-files: projection registration failed: %s', String(error))
      })
    } catch {
      /* an already-settled registration is fine */
    }
    return registration
  }, 'session-files: projection')
}

/** Test seam: the fold definition, so the offline harness can drive it without a Host. */
export const __definition = DEFINITION