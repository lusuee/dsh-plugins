// dsh-open-winc — host half.
//
// One job: start Winc on a directory the page is already showing.
//
//   GET  /__dsh-open-winc/status   { ok, available, editor }  — is Winc installed?
//   POST /__dsh-open-winc/open     { path }                   — start Winc on <path>
//   GET  /__dsh-open-winc/icon                                — Winc's own icon, for the button
//
// Winc takes the folder as a plain positional argument (`winc .`, `winc C:\dir`),
// so nothing has to be composed: the host checks that the path is an existing
// absolute directory, starts the editor detached, and answers immediately. The
// editor keeps running after the request ends, and after DSH quits.
//
// All three routes are ordinary same-origin endpoints and ask the composition's
// `connection` service for a rejection first: its Host/Origin fence defeats DNS
// rebinding and cross-site calls, and it also refuses an unauthenticated peer.
//
// The editor is looked up once per host process (like the open-in-app catalog),
// so a fresh install is picked up by restarting DSH rather than by a page reload.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path'

/** Cordis plugin name; also the bundle row id in cordis.patch.yml. */
export const name = 'dsh-open-winc'

/** Exact route the browser half asks whether an editor exists. */
export const STATUS_ROUTE = '/__dsh-open-winc/status'

/** Exact route that starts the editor. */
export const OPEN_ROUTE = '/__dsh-open-winc/open'

/** Exact route serving the editor's own icon for the header button. */
export const ICON_ROUTE = '/__dsh-open-winc/icon'

/** Largest JSON body accepted by the open route. */
const BODY_LIMIT = 64 * 1024

/** Longest directory string accepted by either route. */
const PATH_LIMIT = 4096

/**
 * Editors tried in order. The environment variable wins so a machine with an
 * unusual install can point at it; the absolute paths cover the Windows default
 * (a per-user NSIS install), where the host process may not inherit the
 * interactive user's PATH; the bare name covers a `winc` on PATH (Unix installs
 * and Windows installers that update PATH).
 */
export function editorCandidates() {
  const list = []
  const fromEnv = process.env.DSH_OPEN_WINC_EDITOR
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') list.push(fromEnv.trim())
  const localAppData = process.env.LOCALAPPDATA
  if (typeof localAppData === 'string' && localAppData !== '') {
    list.push(join(localAppData, 'Programs', 'winc', 'winc.exe'))
  }
  const programFiles = process.env.ProgramFiles
  if (typeof programFiles === 'string' && programFiles !== '') {
    list.push(join(programFiles, 'winc', 'winc.exe'))
  }
  // Winc's macOS app bundle; the installer also links the binary into
  // /usr/local/bin, but a drag-install need not have PATH updated.
  if (process.platform === 'darwin') {
    list.push('/Applications/winc.app/Contents/MacOS/winc')
    list.push('/Applications/Winc.app/Contents/MacOS/winc')
  }
  list.push(process.platform === 'win32' ? 'winc.exe' : 'winc')
  return list
}

/**
 * Resolve one command to an existing file without running a shell: absolute and
 * relative paths are used as given, a bare name is searched on PATH with the
 * platform's PATH delimiter (and PATHEXT on Windows), which is what `spawn`
 * would do but with a testable answer.
 * @param command - candidate from {@link editorCandidates}.
 * @returns the resolved path, or null when nothing matches.
 */
export function lookPath(command) {
  const absolute = isAbsolute(command) || command.includes('/') || command.includes('\\')
  if (absolute) {
    const resolved = resolve(command)
    return existsSync(resolved) ? resolved : null
  }
  const windows = process.platform === 'win32'
  const extensions = windows && extname(command) === ''
    ? String(process.env.PATHEXT ?? '.COM;.EXE').split(';').filter((ext) => ext !== '')
    : ['']
  const directories = String(process.env.PATH ?? '').split(delimiter).filter((dir) => dir !== '')
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = join(directory, command + extension)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** @type {string | null} Resolved editor, or null when the probe found none. */
let editorBinary = null

/** @type {boolean} Whether the probe already ran in this process. */
let editorProbed = false

/**
 * The editor to start, resolved once and remembered. Restarting DSH re-probes,
 * which is the documented way to pick up a newly installed editor.
 * @returns the editor path, or null when none is installed.
 */
export function resolveEditor() {
  if (editorProbed) return editorBinary
  editorProbed = true
  for (const candidate of editorCandidates()) {
    const found = lookPath(candidate)
    if (found !== null) {
      editorBinary = found
      break
    }
  }
  return editorBinary
}

/** Forget the probe result; used by the smoke test, not by the running host. */
export function resetEditorProbe() {
  editorProbed = false
  editorBinary = null
}

/**
 * Accept only an absolute path that names an existing directory.
 * @param value - untrusted value from a JSON body.
 * @returns the resolved directory, or null when the value is unusable.
 */
export function usableDirectory(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > PATH_LIMIT) return null
  if (!isAbsolute(trimmed)) return null
  const directory = resolve(trimmed)
  try {
    if (!statSync(directory).isDirectory()) return null
  } catch {
    return null
  }
  return directory
}

/** Write one JSON response. */function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', String(Buffer.byteLength(payload)))
  res.end(payload)
}

/** Answer a request whose method the route does not serve. */
function sendMethodNotAllowed(res, allow) {
  res.setHeader('allow', allow)
  sendJson(res, 405, { ok: false, reason: 'method-not-allowed' })
}

/**
 * The icon file that belongs to the resolved editor, falling back to the default
 * per-user install. Winc ships `winc.ico` next to `winc.exe`.
 * @returns the .ico path, or null when there is none.
 */
export function resolveIconFile() {
  const candidates = []
  const editor = resolveEditor()
  if (editor !== null) candidates.push(join(dirname(editor), 'winc.ico'))
  const localAppData = process.env.LOCALAPPDATA
  if (typeof localAppData === 'string' && localAppData !== '') {
    candidates.push(join(localAppData, 'Programs', 'winc', 'winc.ico'))
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Take the best square PNG out of an ICO container so the header button gets the
 * real application icon instead of a generic folder. Winc ships PNG-compressed
 * entries; a bitmap-only ICO is served whole, because browsers still read
 * `image/x-icon` but cannot crop a dib out of a multi-image container.
 * @param file - path to an .ico file.
 * @returns the bytes to send and their media type.
 */
export function iconPayloadFrom(file) {
  const buffer = readFileSync(file)
  const usableHeader =
    buffer.length >= 6 && buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1
  if (!usableHeader) return { bytes: buffer, mime: 'image/x-icon' }
  const count = buffer.readUInt16LE(4)
  let best
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16
    if (entry + 16 > buffer.length) break
    const width = buffer[entry] === 0 ? 256 : buffer[entry]
    const height = buffer[entry + 1] === 0 ? 256 : buffer[entry + 1]
    const size = buffer.readUInt32LE(entry + 8)
    const offset = buffer.readUInt32LE(entry + 12)
    if (size < 8 || offset + size > buffer.length) continue
    const isPng =
      buffer[offset] === 0x89 &&
      buffer[offset + 1] === 0x50 &&
      buffer[offset + 2] === 0x4e &&
      buffer[offset + 3] === 0x47
    if (!isPng || width !== height) continue
    // Smallest square of at least 32 px: crisp behind a 13 px glyph at 2x
    // without shipping the 256 px frame every time. Narrower entries only win
    // when nothing larger exists.
    const score = width >= 32 ? width : 1000 + width
    if (best === undefined || score < best.score) best = { score, offset, size }
  }
  if (best === undefined) return { bytes: buffer, mime: 'image/x-icon' }
  return { bytes: buffer.subarray(best.offset, best.offset + best.size), mime: 'image/png' }
}

/** @type {{ bytes: Buffer, mime: string } | null | undefined} Cached icon payload. */
let iconPayload

/** Forget the cached icon; used by the smoke test, not by the running host. */
export function resetIconProbe() {
  iconPayload = undefined
}

/**
 * GET /__dsh-open-winc/icon — the editor's own icon.
 * @param ctx - the composition context that owns the services.
 */
export async function handleIcon(ctx, req, res) {
  if (rejected(ctx, req, res)) return
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res, 'GET')
    return
  }
  if (iconPayload === undefined) {
    const file = resolveIconFile()
    iconPayload = file === null ? null : iconPayloadFrom(file)
  }
  if (iconPayload === null) {
    sendJson(res, 404, { ok: false, reason: 'icon-missing' })
    return
  }
  res.statusCode = 200
  res.setHeader('content-type', iconPayload.mime)
  res.setHeader('cache-control', 'public, max-age=300')
  res.setHeader('content-length', String(iconPayload.bytes.length))
  res.end(iconPayload.bytes)
}

/** Read a bounded JSON object body; undefined when it is absent, huge, or not JSON. */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT) return undefined
    chunks.push(chunk)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

/**
 * Answer an untrusted or unauthenticated request.
 * @returns true when the request was rejected and already answered.
 */
function rejected(ctx, req, res) {
  const connection = ctx.connection
  if (connection === undefined || connection === null) return false
  if (typeof connection.requestRejection !== 'function') return false
  const rejection = connection.requestRejection(req)
  if (rejection === undefined || rejection === null) return false
  res.statusCode = typeof rejection === 'number' ? rejection : 403
  res.end()
  return true
}

/**
 * GET /__dsh-open-winc/status — whether the browser half should show its button.
 * @param ctx - the composition context that owns the services.
 */
export async function handleStatus(ctx, req, res) {
  if (rejected(ctx, req, res)) return
  if (req.method !== 'GET') {
    sendMethodNotAllowed(res, 'GET')
    return
  }
  const editor = resolveEditor()
  sendJson(res, 200, {
    ok: true,
    available: editor !== null,
    editor: editor === null ? null : basename(editor),
  })
}

/**
 * POST /__dsh-open-winc/open — start the editor on `{ path }`.
 * @param ctx - the composition context that owns the services.
 */
export async function handleOpen(ctx, req, res) {
  if (rejected(ctx, req, res)) return
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, 'POST')
    return
  }
  const body = await readJson(req)
  if (body === undefined) {
    sendJson(res, 400, { ok: false, reason: 'bad-body' })
    return
  }
  const directory = usableDirectory(body.path)
  if (directory === null) {
    sendJson(res, 200, { ok: false, reason: 'bad-path' })
    return
  }
  const editor = resolveEditor()
  if (editor === null) {
    sendJson(res, 200, { ok: false, reason: 'editor-missing' })
    return
  }
  try {
    // Detached and stdio-free: the editor outlives this request, and a window it
    // opens must not be tied to the host's console. Its own launch failures are
    // reported asynchronously, so the listener keeps them from crashing the host.
    const child = spawn(editor, [directory], {
      cwd: directory,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.on('error', () => {})
    child.unref()
    sendJson(res, 200, { ok: true, editor: basename(editor), path: directory })
  } catch (error) {
    sendJson(res, 200, { ok: false, reason: 'spawn-failed', message: String(error) })
  }
}

/** Internals exposed for the package's own smoke test; not a public contract. */
export const __internals = {
  editorCandidates,
  lookPath,
  resolveEditor,
  resetEditorProbe,
  resolveIconFile,
  iconPayloadFrom,
  resetIconProbe,
  usableDirectory,
  handleStatus,
  handleOpen,
  handleIcon,
}

/**
 * Mount the three routes.
 * @param ctx - host root context.
 */
export function apply(ctx) {
  ctx.inject(['webServer', 'connection'], (routeCtx) => {
    const routes = [
      { path: STATUS_ROUTE, handler: (req, res) => handleStatus(routeCtx, req, res), label: 'status' },
      { path: OPEN_ROUTE, handler: (req, res) => handleOpen(routeCtx, req, res), label: 'open' },
      { path: ICON_ROUTE, handler: (req, res) => handleIcon(routeCtx, req, res), label: 'icon' },
    ]
    for (const route of routes) {
      routeCtx.effect(
        () => routeCtx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }),
        `dsh-open-winc: ${route.label} route`,
      )
    }
  })
}
