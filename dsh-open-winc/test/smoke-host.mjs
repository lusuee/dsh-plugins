// Smoke test for the host half: drives the two route handlers with fake
// request/response objects, so no web server and no real editor are involved.
// Run with: node test/smoke-host.mjs
import { strict as assert } from 'node:assert'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  editorCandidates,
  handleIcon,
  handleOpen,
  handleStatus,
  iconPayloadFrom,
  lookPath,
  resetEditorProbe,
  resetIconProbe,
  resolveEditor,
  resolveIconFile,
  usableDirectory,
} from '../lib/index.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const workdir = mkdtempSync(join(tmpdir(), 'dsh-open-winc-'))
const fileInWorkdir = join(workdir, 'a-file.txt')
writeFileSync(fileInWorkdir, 'x')
// The scratch directory goes away even when an assertion fails mid-run. A
// detached child may still sit in it (the open case launches from there), so a
// stubborn leftover is tolerated instead of failing the suite.
const removeWorkdir = () => {
  try {
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch {
    // Left in the OS temp directory; nothing else depends on it.
  }
}
process.on('exit', removeWorkdir)

/** Build a fake IncomingMessage with a JSON body (or a raw string). */
function request(method, body) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const chunks = text === '' ? [] : [Buffer.from(text, 'utf8')]
  return {
    method,
    url: '/',
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

/** Build a fake ServerResponse that records what the handler wrote. */
function response() {
  const recorded = { statusCode: 0, headers: {}, payload: '', raw: undefined }
  return {
    get statusCode() {
      return recorded.statusCode
    },
    set statusCode(value) {
      recorded.statusCode = value
    },
    setHeader(name, value) {
      recorded.headers[name.toLowerCase()] = value
    },
    end(payload) {
      recorded.raw = payload
      recorded.payload = payload === undefined ? '' : String(payload)
    },
    json() {
      return recorded.payload === '' ? undefined : JSON.parse(recorded.payload)
    },
    recorded,
  }
}

/** A context whose connection fence accepts everything unless `fence` says otherwise. */
function context(fence = undefined) {
  return {
    connection: {
      requestRejection: () => fence,
    },
  }
}

/** A context with no connection service at all: the fence must simply pass. */
function bareContext() {
  return {}
}

const cases = []
function test(name, run) {
  cases.push({ name, run })
}

// ── editor resolution ───────────────────────────────────────────────────────

test('editorCandidates puts the environment variable first', () => {
  const saved = process.env.DSH_OPEN_WINC_EDITOR
  process.env.DSH_OPEN_WINC_EDITOR = 'C:\\custom\\winc.exe'
  try {
    const candidates = editorCandidates()
    assert.equal(candidates[0], 'C:\\custom\\winc.exe')
    assert.ok(candidates.includes('winc.exe'))
  } finally {
    if (saved === undefined) delete process.env.DSH_OPEN_WINC_EDITOR
    else process.env.DSH_OPEN_WINC_EDITOR = saved
  }
})

test('lookPath resolves a real binary and rejects a missing one', () => {
  const where = lookPath(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe'))
  assert.ok(where !== null && existsSync(where))
  assert.equal(lookPath('dsh-open-winc-does-not-exist.exe'), null)
})

test('resolveEditor finds the installed Winc on this machine', () => {
  resetEditorProbe()
  const editor = resolveEditor()
  const expected = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'winc', 'winc.exe')
  if (existsSync(expected)) {
    assert.equal(editor, expected)
  } else {
    assert.ok(editor === null || editor.endsWith('winc.exe'))
  }
})

test('resolveEditor reports editor-missing when nothing is installed', async () => {
  const saved = {
    env: process.env.DSH_OPEN_WINC_EDITOR,
    local: process.env.LOCALAPPDATA,
    program: process.env.ProgramFiles,
    path: process.env.PATH,
  }
  process.env.DSH_OPEN_WINC_EDITOR = 'C:\\definitely\\missing\\winc.exe'
  process.env.LOCALAPPDATA = 'C:\\definitely\\missing'
  process.env.ProgramFiles = 'C:\\definitely\\missing'
  process.env.PATH = 'C:\\definitely\\missing'
  resetEditorProbe()
  try {
    assert.equal(resolveEditor(), null)
    const res = response()
    await handleOpen(context(), request('POST', { path: workdir }), res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json(), { ok: false, reason: 'editor-missing' })
  } finally {
    const restore = (key, value) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    restore('DSH_OPEN_WINC_EDITOR', saved.env)
    restore('LOCALAPPDATA', saved.local)
    restore('ProgramFiles', saved.program)
    restore('PATH', saved.path)
    resetEditorProbe()
  }
})

// ── path validation ─────────────────────────────────────────────────────────

test('usableDirectory accepts an existing directory only', () => {
  assert.equal(usableDirectory(workdir), workdir)
  assert.equal(usableDirectory('.'), null, 'relative paths are refused')
  assert.equal(usableDirectory(''), null)
  assert.equal(usableDirectory('   '), null)
  assert.equal(usableDirectory(123), null)
  assert.equal(usableDirectory(null), null)
  assert.equal(usableDirectory(fileInWorkdir), null, 'a file is not a directory')
  assert.equal(usableDirectory(join(workdir, 'nope')), null)
})

// ── GET /status ─────────────────────────────────────────────────────────────

test('status answers availability as JSON and refuses other methods', async () => {
  resetEditorProbe()
  const ok = response()
  await handleStatus(context(), request('GET'), ok)
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.recorded.headers['cache-control'], 'no-store')
  assert.match(ok.recorded.headers['content-type'], /application\/json/)
  const body = ok.json()
  assert.equal(body.ok, true)
  assert.equal(typeof body.available, 'boolean')
  assert.equal(body.available, resolveEditor() !== null)

  const wrong = response()
  await handleStatus(context(), request('POST'), wrong)
  assert.equal(wrong.statusCode, 405)
  assert.equal(wrong.recorded.headers.allow, 'GET')
  assert.deepEqual(wrong.json(), { ok: false, reason: 'method-not-allowed' })
})

test('status passes when the composition has no connection service', async () => {
  const res = response()
  await handleStatus(bareContext(), request('GET'), res)
  assert.equal(res.statusCode, 200)
})

// ── POST /open ──────────────────────────────────────────────────────────────

test('open launches the editor detached and reports the directory', async () => {
  const saved = process.env.DSH_OPEN_WINC_EDITOR
  // A harmless stand-in that exits at once and writes nothing.
  process.env.DSH_OPEN_WINC_EDITOR = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe')
  resetEditorProbe()
  try {
    const res = response()
    await handleOpen(context(), request('POST', { path: workdir }), res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json(), { ok: true, editor: 'where.exe', path: workdir })
  } finally {
    if (saved === undefined) delete process.env.DSH_OPEN_WINC_EDITOR
    else process.env.DSH_OPEN_WINC_EDITOR = saved
    resetEditorProbe()
  }
})

test('open refuses a wrong method, a bad body, and an unusable path', async () => {
  const wrongMethod = response()
  await handleOpen(context(), request('GET'), wrongMethod)
  assert.equal(wrongMethod.statusCode, 405)
  assert.equal(wrongMethod.recorded.headers.allow, 'POST')

  const badJson = response()
  await handleOpen(context(), request('POST', 'not json'), badJson)
  assert.equal(badJson.statusCode, 400)
  assert.deepEqual(badJson.json(), { ok: false, reason: 'bad-body' })

  const arrayBody = response()
  await handleOpen(context(), request('POST', '[1,2,3]'), arrayBody)
  assert.equal(arrayBody.statusCode, 400)

  for (const path of ['.', '', fileInWorkdir, join(workdir, 'missing'), 42]) {
    const res = response()
    await handleOpen(context(), request('POST', { path }), res)
    assert.equal(res.statusCode, 200, `path ${JSON.stringify(path)}`)
    assert.deepEqual(res.json(), { ok: false, reason: 'bad-path' })
  }
})

test('an oversized body is refused before parsing', async () => {
  const huge = JSON.stringify({ path: workdir, padding: 'x'.repeat(70 * 1024) })
  const res = response()
  await handleOpen(context(), request('POST', huge), res)
  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.json(), { ok: false, reason: 'bad-body' })
})

// ── fence ───────────────────────────────────────────────────────────────────

test('a fenced request is answered with the fence status and never launches', async () => {
  const saved = process.env.DSH_OPEN_WINC_EDITOR
  process.env.DSH_OPEN_WINC_EDITOR = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe')
  resetEditorProbe()
  try {
    for (const handler of [handleStatus, handleOpen]) {
      const res = response()
      await handler(context(403), request(handler === handleStatus ? 'GET' : 'POST', { path: workdir }), res)
      assert.equal(res.statusCode, 403)
      assert.equal(res.recorded.payload, '')
    }
  } finally {
    if (saved === undefined) delete process.env.DSH_OPEN_WINC_EDITOR
    else process.env.DSH_OPEN_WINC_EDITOR = saved
    resetEditorProbe()
  }
})

// ── GET /icon ───────────────────────────────────────────────────────────────

test('the icon comes from the editor install and is a PNG frame', async () => {
  resetEditorProbe()
  resetIconProbe()
  const file = resolveIconFile()
  const expected = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'winc', 'winc.ico')
  if (existsSync(expected)) {
    assert.equal(file, expected)
  } else {
    assert.ok(file === null || file.endsWith('.ico'))
  }
  if (file === null) return

  const payload = iconPayloadFrom(file)
  assert.equal(payload.mime, 'image/png', 'Winc ships PNG-compressed frames')
  assert.deepEqual([...payload.bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  const width = payload.bytes.readUInt32BE(16)
  const height = payload.bytes.readUInt32BE(20)
  assert.equal(width, height)
  assert.ok(width >= 32 && width <= 256, `unexpected frame ${width}px`)
  assert.ok(payload.bytes.length > 200)

  const res = response()
  await handleIcon(context(), request('GET'), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.recorded.headers['content-type'], 'image/png')
  assert.match(String(res.recorded.headers['cache-control']), /max-age=\d+/)
  assert.ok(Buffer.isBuffer(res.recorded.raw) && res.recorded.raw.length === payload.bytes.length)
})

test('the icon route refuses a wrong method and a fenced request', async () => {
  const wrongMethod = response()
  await handleIcon(context(), request('POST'), wrongMethod)
  assert.equal(wrongMethod.statusCode, 405)
  assert.equal(wrongMethod.recorded.headers.allow, 'GET')

  const fenced = response()
  await handleIcon(context(403), request('GET'), fenced)
  assert.equal(fenced.statusCode, 403)
  assert.equal(fenced.recorded.payload, '')
})

test('the icon route answers 404 when the editor has no icon file', async () => {
  const saved = {
    env: process.env.DSH_OPEN_WINC_EDITOR,
    local: process.env.LOCALAPPDATA,
  }
  process.env.DSH_OPEN_WINC_EDITOR = join(workdir, 'winc.exe')
  process.env.LOCALAPPDATA = 'C:\\definitely\\missing'
  resetEditorProbe()
  resetIconProbe()
  try {
    assert.equal(resolveIconFile(), null)
    const res = response()
    await handleIcon(context(), request('GET'), res)
    assert.equal(res.statusCode, 404)
    assert.deepEqual(res.json(), { ok: false, reason: 'icon-missing' })
  } finally {
    if (saved.env === undefined) delete process.env.DSH_OPEN_WINC_EDITOR
    else process.env.DSH_OPEN_WINC_EDITOR = saved.env
    if (saved.local === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = saved.local
    resetEditorProbe()
    resetIconProbe()
  }
})

// ── mounting ────────────────────────────────────────────────────────────────

test('apply mounts exactly three exact routes and tears them down', async () => {
  const { apply } = await import('../lib/index.js')
  const mounted = []
  const disposers = []
  const routeCtx = {
    connection: { requestRejection: () => undefined },
    webServer: {
      register(route) {
        mounted.push(route)
        return () => {}
      },
    },
    effect(factory) {
      disposers.push(factory())
    },
  }
  apply({
    inject(names, run) {
      assert.deepEqual(names, ['webServer', 'connection'])
      run(routeCtx)
    },
  })
  assert.deepEqual(mounted.map((route) => [route.path, route.kind]), [
    ['/__dsh-open-winc/status', 'exact'],
    ['/__dsh-open-winc/open', 'exact'],
    ['/__dsh-open-winc/icon', 'exact'],
  ])
  assert.equal(disposers.length, 3)
  assert.ok(disposers.every((dispose) => typeof dispose === 'function'))

  // The mounted handlers answer without the test wiring anything else.
  resetEditorProbe()
  const res = response()
  await mounted[0].handler(request('GET'), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().ok, true)
})

// ── runner ──────────────────────────────────────────────────────────────────

let failed = 0
for (const { name, run } of cases) {
  try {
    await run()
    console.log('ok   ', name)
  } catch (error) {
    failed += 1
    console.log('FAIL ', name)
    console.log('      ', error instanceof Error ? error.message : String(error))
  }
}
console.log(failed === 0 ? `all ${cases.length} cases passed` : `${failed} of ${cases.length} cases failed`)
process.exitCode = failed === 0 ? 0 : 1
console.log('package:', here)
