import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Host half of `dsh-plugin-session-files`.
 *
 * One job: fold the Session event log into a single session-scoped list of the
 * files this Session wrote, edited, or delivered. The fold is a
 * `sessionProjections` unit, so the Host owns the authoritative answer: it
 * replays the committed log, survives reconnects, and the browser only renders
 * what the Host published.
 *
 * The Host half also owns `POST /session-files/trash`, the one route the view's
 * per-file recycle action posts to: a browser cannot delete a Host file on its
 * own, and the route refuses any path this Session did not produce.
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

/* ------------------------------------------------------------------ */
/* Recycle route                                                       */
/* ------------------------------------------------------------------ */

/** Exact route the browser half posts a confirmed recycle action to. */
const TRASH_ROUTE = '/session-files/trash'

/** A recycle request is two short strings; anything larger is hostile. */
const MAX_BODY_BYTES = 8 * 1024

/** One rm-safe run may take a moment; a stuck PowerShell must not hold the response. */
const RM_SAFE_TIMEOUT_MS = 30_000

/** PowerShell color escapes, stripped before parsing its report. */
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g

/**
 * The newest folded state per Session. The recycle route uses it as the
 * membership proof: a path can only be recycled when this Session is what
 * produced it, so a crafted request cannot reach an arbitrary file.
 */
const sessionStates = new Map()

/**
 * Remember the newest state for the Session it belongs to.
 * @param state - a state built by init or fold.
 * @returns the same state, for expression position.
 */
function track(state) {
  const sessionId = isRecord(state) ? textOf(state.sessionId) : ''
  if (sessionId !== '') sessionStates.set(sessionId, state)
  return state
}

/** @param ctx - plugin context. @returns the composition's connection fence, if any. */
function connectionOf(ctx) {
  return Reflect.get(ctx, 'connection')
}

/**
 * Send one JSON response; no recycle outcome is cacheable.
 * @param res - server response.
 * @param status - HTTP status.
 * @param payload - serializable body.
 */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * Refuse a request the connection service does not trust.
 * @param ctx - plugin context.
 * @param req - incoming request.
 * @param res - server response.
 * @returns true when it already answered with a refusal.
 */
function rejectedByConnection(ctx, req, res) {
  const connection = connectionOf(ctx)
  if (connection === undefined || connection === null || typeof connection.requestRejection !== 'function') {
    // A recycle route without the trust fence must never answer: the service
    // is injected, so this only guards a mis-composed Host.
    res.statusCode = 403
    res.end()
    return true
  }
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

/**
 * Collect a bounded request body as UTF-8 text; null past the ceiling, with
 * the rest drained so the refusal is a readable response instead of a cut socket.
 * @param req - incoming request.
 * @returns the body text, or null when it is too large.
 */
async function readBoundedBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/**
 * PowerShell single-quoted literal; the only escape inside one is `''`.
 * @param value - raw text.
 * @returns the literal source.
 */
function psLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * The encoded command that dot-sources rm-safe and recycles exactly one path.
 * Encoding keeps a path containing quotes or spaces out of the shell grammar.
 * @param script - absolute rm-safe.ps1 path.
 * @param target - absolute file path.
 * @returns UTF-16LE base64 for `-EncodedCommand`.
 */
function rmSafeCommand(script, target) {
  return Buffer.from(`. ${psLiteral(script)}; rm-safe -Path ${psLiteral(target)}`, 'utf16le').toString('base64')
}

/**
 * Run one PowerShell executable with an encoded command.
 * @param executable - `pwsh.exe` or `powershell.exe`.
 * @param encoded - UTF-16LE base64 command.
 * @returns `{ code, stdout, stderr, error?, timedOut? }`.
 */
function runPowerShell(executable, encoded) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true })
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', error })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (outcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already exited */
      }
      finish({ code: null, stdout, stderr, timedOut: true })
    }, RM_SAFE_TIMEOUT_MS)
    if (child.stdout !== null) child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    if (child.stderr !== null) child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => finish({ code: null, stdout, stderr, error }))
    child.on('close', (code) => finish({ code, stdout, stderr }))
  })
}

/**
 * The last non-empty line of a report, for an error message.
 * @param text - captured output.
 * @returns the trimmed last line, or ''.
 */
function lastLine(text) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')
  return lines.length === 0 ? '' : lines[lines.length - 1]
}

/**
 * Recycle one file through rm-safe: the native Recycle Bin when the volume's
 * bin is writable, otherwise a same-directory `.trash` quarantine. Both keep
 * the bytes, so a mistaken click stays recoverable.
 * @param target - the absolute, Session-tracked file path.
 * @returns `{ ok: true, method, trashPath, detail }` or `{ ok: false, message }`.
 */
async function recycleThroughRmSafe(target) {
  const script = process.env.DSH_RM_SAFE ?? join(homedir(), '.dsh', 'dsh-ops', 'rm-safe.ps1')
  if (!existsSync(script)) return { ok: false, message: 'rm-safe.ps1 不存在：' + script }
  const encoded = rmSafeCommand(script, target)
  let run = await runPowerShell('pwsh.exe', encoded)
  if (run.error !== undefined && run.error.code === 'ENOENT') run = await runPowerShell('powershell.exe', encoded)
  if (run.timedOut === true) return { ok: false, message: 'rm-safe 超时未返回。' }
  if (run.error !== undefined) return { ok: false, message: '无法启动 PowerShell：' + String(run.error.message ?? run.error) }
  const stdout = String(run.stdout).replace(ANSI_ESCAPE, '')
  const stderr = String(run.stderr).replace(ANSI_ESCAPE, '')
  if (existsSync(target)) return { ok: false, message: lastLine(stderr) || lastLine(stdout) || '文件仍然存在，回收未完成。' }
  const quarantined = /→\s*隔离区/.test(stdout)
  const marker = /⇒\s*(.+)/.exec(stdout)
  return {
    ok: true,
    method: quarantined ? 'quarantine' : 'recycle',
    trashPath: marker === null ? '' : marker[1].trim(),
    detail: lastLine(stdout),
  }
}

/**
 * Read one recycle-request body.
 * @param body - raw UTF-8 JSON text.
 * @returns `{ sessionId, path }`, or undefined when the shape is wrong.
 */
function parseTrashBody(body) {
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  if (typeof parsed.sessionId !== 'string' || parsed.sessionId === '') return undefined
  if (typeof parsed.path !== 'string' || parsed.path === '') return undefined
  return { sessionId: parsed.sessionId, path: parsed.path }
}

/**
 * Answer POST /session-files/trash: prove the path is one this Session actually
 * produced, then recycle the file through rm-safe. The browser never names a
 * file the Host has not already folded, and only files are accepted.
 * @param ctx - plugin context (for the connection trust fence).
 * @returns the route handler.
 */
function createTrashHandler(ctx) {
  return async function handleTrash(req, res) {
    try {
      if (rejectedByConnection(ctx, req, res)) return
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) {
        sendJson(res, 415, { ok: false, code: 'unsupported-media-type', message: '请求体必须是 application/json。' })
        return
      }
      const body = await readBoundedBody(req)
      if (body === null) {
        sendJson(res, 413, { ok: false, code: 'payload-too-large', message: '请求体过大。' })
        return
      }
      const request = parseTrashBody(body)
      if (request === undefined) {
        sendJson(res, 400, { ok: false, code: 'bad-request', message: '需要 sessionId 与 path。' })
        return
      }
      const state = sessionStates.get(request.sessionId)
      if (state === undefined) {
        sendJson(res, 404, { ok: false, code: 'unknown-session', message: 'Host 还没有折叠这个会话。' })
        return
      }
      const normalized = normalizePath(request.path)
      const key = state.foldCase ? normalized.toLowerCase() : normalized
      const at = state.index[key]
      if (at === undefined) {
        sendJson(res, 403, { ok: false, code: 'not-tracked', message: '这个路径不在本会话的文件列表里。' })
        return
      }
      const target = state.files[at].path
      let info
      try {
        info = statSync(target)
      } catch {
        sendJson(res, 404, { ok: false, code: 'missing', message: '文件已经不存在了。' })
        return
      }
      if (!info.isFile()) {
        sendJson(res, 400, { ok: false, code: 'not-file', message: '只能回收文件，不能回收目录。' })
        return
      }
      const outcome = await recycleThroughRmSafe(target)
      if (outcome.ok !== true) {
        sendJson(res, 502, { ok: false, code: 'rm-safe-failed', message: outcome.message })
        return
      }
      sendJson(res, 200, { ok: true, path: target, method: outcome.method, trashPath: outcome.trashPath, detail: outcome.detail })
    } catch (error) {
      try {
        sendJson(res, 500, { ok: false, code: 'internal', message: String(error && error.message ? error.message : error) })
      } catch {
        /* the socket may already be gone; nothing left to answer */
      }
    }
  }
}

/**
 * Register the recycle route on the composition's web server when it has one.
 * @param ctx - plugin context.
 * @returns the disposer, or a no-op when the route cannot be served.
 */
function registerTrashRoute(ctx) {
  let server
  try {
    server = ctx.get('webServer')
  } catch {
    server = undefined
  }
  if (server === undefined || server === null || typeof server.register !== 'function') {
    warn(ctx, 'session-files: 没有 webServer，回收按钮不可用')
    return () => {}
  }
  return server.register({ kind: 'exact', path: TRASH_ROUTE, handler: createTrashHandler(ctx) })
}

/**
 * Log one plugin warning without letting a missing logger break the plugin.
 * @param ctx - plugin context.
 * @param message - the warning text.
 */
function warn(ctx, message) {
  try {
    if (ctx.logger !== undefined && typeof ctx.logger.warn === 'function') ctx.logger.warn(message)
  } catch {
    /* a logger that throws is not worth the plugin */
  }
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
    const sessionId = textOf(header?.id)
    const cwd = normalizePath(textOf(header?.cwd))
    const files = []
    return track({ sessionId, cwd, foldCase: foldsCase(cwd), files, calls: {}, index: {}, view: { cwd, files } })
  },
  /**
   * Fold one committed event. Every unrelated event returns the same state
   * reference, so the projection never republishes unchanged data.
   * @param state - current fold state.
   * @param event - one committed Session event.
   * @returns the next state.
   */
  fold(state, event) {
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
  /**
   * Fold one event for the registry, remembering the Session's newest state so
   * the recycle route can prove that a path belongs to the Session asking.
   * @param state - current fold state.
   * @param event - one committed Session event.
   * @returns the next state.
   */
  apply(state, event) {
    return track(DEFINITION.fold(state, event))
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

/**
 * Host plugin body: register the fold on the calling fiber. `webServer` and
 * `connection` are required because the recycle route is part of the plugin's
 * contract: the route must exist, and it must be behind the same trust fence
 * every other browser-facing route uses.
 */
export const inject = ['sessionProjections', 'webServer', 'connection']

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

  ctx.effect(() => {
    try {
      return registerTrashRoute(ctx)
    } catch (error) {
      warn(ctx, 'session-files: 回收路由注册失败：' + String(error))
      return () => {}
    }
  }, 'session-files: trash route')
}

/** Test seam: the fold definition, so the offline harness can drive it without a Host. */
export const __definition = DEFINITION

/** Test seam: the recycle route, its handler factory, and the Session state registry. */
export const __trashRoute = {
  path: TRASH_ROUTE,
  createHandler: createTrashHandler,
  sessions: sessionStates,
  command: rmSafeCommand,
}