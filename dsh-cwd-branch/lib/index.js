// dsh-cwd-branch — host half.
//
// Four same-origin JSON routes, all local to the DSH web server:
//
//   GET  /__dsh-cwd-branch/status?cwd=…     which repository/branch is this?
//   GET  /__dsh-cwd-branch/checkouts?cwd=…  main checkout + worktrees + free branches
//   POST /__dsh-cwd-branch/switch           move a session to another directory
//   POST /__dsh-cwd-branch/worktree         create a worktree for a branch, then move there
//
// The browser half (lib/client.js) renders the answer next to the permission
// chip in the composer tool row; it never runs git itself, because the page
// cannot, and it cannot move a session, because only the host holds the
// working-directory service.
//
// The status and checkout routes only report names — never file contents,
// never the environment, never anything the caller cannot already see in the
// page — so they take the directory from the query string without a capability
// token. The two POST routes are held to the same standard: they act on a
// session the local page already owns, and they refuse anything that is not an
// existing directory inside a repository.

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

/** Cordis plugin name. */
export const name = 'dsh-cwd-branch'

/** Exact route the browser half polls. */
const ROUTE = '/__dsh-cwd-branch/status'

/** Exact route listing the checkouts of the repository. */
const CHECKOUTS_ROUTE = '/__dsh-cwd-branch/checkouts'

/** Exact route moving a session to another checkout. */
const SWITCH_ROUTE = '/__dsh-cwd-branch/switch'

/** Exact route creating a worktree for a branch. */
const WORKTREE_ROUTE = '/__dsh-cwd-branch/worktree'
/** POST: run `git checkout <branch>` in the session's own checkout. */
export const CHECKOUT_ROUTE = '/__dsh-cwd-branch/checkout'
/** Diagnostics only: which sessions this host holds a live agent for. */
const SESSIONS_ROUTE = '/__dsh-cwd-branch/sessions'

/** A cached answer younger than this is reused instead of spawning git. */
const CACHE_TTL_MS = 2500

/** Entries kept in the cache before the oldest is dropped. */
const CACHE_LIMIT = 64

/** Upper bound on one git invocation. */
const GIT_TIMEOUT_MS = 4000

/** Upper bound on the git invocation that creates a worktree. */
const WORKTREE_TIMEOUT_MS = 30000

/** Longest directory string accepted from the query string. */
const CWD_LIMIT = 4096

/** Largest JSON body accepted by the two POST routes. */
const BODY_LIMIT = 64 * 1024

/** Where new worktrees are created, relative to the main checkout. */
const WORKTREE_DIR = '.agents/worktrees'

/**
 * Git binaries tried in order. The environment variable wins so a host with an
 * unusual installation can point at it; the absolute paths cover the Windows
 * default install, where the service process may not inherit the interactive
 * user's PATH.
 */
function gitCandidates() {
  const fromEnv = process.env.DSH_CWD_BRANCH_GIT
  const fixed = [
    'git',
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files (x86)\\Git\\bin\\git.exe',
    '/usr/bin/git',
    '/usr/local/bin/git',
  ]
  return fromEnv === undefined || fromEnv === '' ? fixed : [fromEnv, ...fixed]
}

/** @type {string | null | undefined} Resolved binary, undefined until first probe. */
let gitBinary

/** Run one git command and resolve its trimmed stdout, or undefined on failure. */
function git(cwd, args, timeout = GIT_TIMEOUT_MS) {
  const binary = gitBinary
  if (binary === undefined || binary === null) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    execFile(
      binary,
      ['-C', cwd, ...args],
      { timeout, windowsHide: true, maxBuffer: 4 << 20 },
      (error, stdout) => {
        resolve(error ? undefined : String(stdout).replace(/\s+$/, ''))
      },
    )
  })
}

/**
 * Run one git command and report its status plus both streams. The plain helper
 * above throws the streams away, which is fine for reading state and useless for
 * a checkout: git's refusal is the only thing worth showing the user.
 */
function gitRun(cwd, args, timeout = GIT_TIMEOUT_MS) {
  const binary = gitBinary
  if (binary === undefined || binary === null) {
    return Promise.resolve({ ok: false, code: -1, stdout: '', stderr: 'git not resolved' })
  }
  return new Promise((resolveRun) => {
    execFile(
      binary,
      ['-C', cwd, ...args],
      { timeout, windowsHide: true, maxBuffer: 4 << 20 },
      (error, stdout, stderr) => {
        resolveRun({
          ok: error === null || error === undefined,
          code: error === null || error === undefined ? 0 : typeof error.code === 'number' ? error.code : -1,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        })
      },
    )
  })
}

/**
 * One line of git's complaint, minus the `error:`/`fatal:` prefix, for a menu
 * row that has no room for a paragraph.
 */
function gitComplaint(stderr) {
  const lines = String(stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const head = (lines[0] ?? '').replace(/^(error|fatal):\s*/i, '')
  const detail = lines.slice(1).find((line) => !/^(error|fatal|hint):/i.test(line)) ?? ''
  const text = `${head} ${detail}`.trim()
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

/** Probe the candidates until one answers `--version`; remember the winner. */
async function resolveGit() {
  for (const candidate of gitCandidates()) {
    const answer = await new Promise((resolve) => {
      execFile(candidate, ['--version'], { timeout: 4000, windowsHide: true }, (error, stdout) => {
        resolve(error ? undefined : String(stdout).trim())
      })
    })
    if (answer !== undefined) {
      gitBinary = candidate
      return answer
    }
  }
  gitBinary = null
  return undefined
}

/** Split `git rev-parse` output into its non-empty lines. */
function outputLines(text) {
  return text === undefined ? [] : text.split(/\r?\n/).filter((line) => line !== '')
}

/** Compare two absolute paths, honouring Windows's case-insensitive names. */
function samePath(left, right) {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Where `cwd` sits inside its checkout.
 *
 * A linked worktree has a git directory under the main repository's
 * `.git/worktrees/<name>` but shares that repository's common directory, so the
 * two answers differing is exactly what "I am in a worktree" means. Reporting
 * the main repository and the worktree's own directory name lets the badge say
 * `repo › worktree` instead of only the tail of an absolute path.
 *
 * @param cwd - the directory being described.
 * @param top - the checkout root `git rev-parse --show-toplevel` named.
 */
async function checkoutOf(cwd, top) {
  let gitDir
  let commonDir
  const triple = await git(cwd, ['rev-parse', '--path-format=absolute', '--absolute-git-dir', '--git-common-dir'])
  if (triple !== undefined) {
    const parts = outputLines(triple)
    gitDir = parts[0]
    commonDir = parts[1]
  } else {
    // git before 2.31 has no --path-format, so a relative answer is resolved
    // against the checkout root instead of being trusted as absolute.
    const parts = outputLines(await git(cwd, ['rev-parse', '--absolute-git-dir', '--git-common-dir']))
    gitDir = parts[0]
    commonDir = parts[1] === undefined ? undefined : resolve(top, parts[1])
  }

  const isWorktree = gitDir !== undefined && commonDir !== undefined && !samePath(gitDir, commonDir)
  // The common directory is the main repository's `.git`; its parent is the
  // working tree that worktree belongs to. A bare or relocated common directory
  // is reported as itself.
  const mainRepoRoot = isWorktree ? (basename(commonDir) === '.git' ? dirname(commonDir) : commonDir) : null
  const below = relative(top, cwd)

  return {
    isWorktree,
    worktreeName: isWorktree ? basename(top) : null,
    mainRepoRoot,
    mainRepo: mainRepoRoot === null ? null : basename(mainRepoRoot),
    subPath: below === '' ? null : below.split(sep).join('/'),
  }
}

/**
 * Describe `cwd`: its repository root, current branch, and whether that root is
 * a linked git worktree of a larger repository.
 * @param cwd - an absolute directory path.
 * @returns the report the route serves.
 */
async function reportFor(cwd) {
  const top = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (top === undefined || top === '') {
    return {
      cwd,
      repoRoot: null,
      branch: null,
      detached: false,
      dirty: false,
      notRepo: true,
      isWorktree: false,
      worktreeName: null,
      mainRepoRoot: null,
      mainRepo: null,
      subPath: null,
    }
  }

  // symbolic-ref survives an unborn branch (a fresh `git init` has no commit
  // for rev-parse to name), so it is asked first; a detached HEAD refuses it
  // and is then reported by its short commit id.
  let branch = await git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])
  let detached = false
  if (branch === undefined || branch === '') {
    const sha = await git(cwd, ['rev-parse', '--short', 'HEAD'])
    branch = sha === undefined || sha === '' ? null : sha
    detached = branch !== null
  }

  // Untracked files are ignored: a build directory would otherwise mark every
  // repository dirty forever, and the badge is about tracked work.
  const porcelain = await git(cwd, ['status', '--porcelain', '-uno'], 4000)
  const dirty = porcelain !== undefined && porcelain !== ''

  const checkout = await checkoutOf(cwd, top)

  return {
    cwd,
    repoRoot: top,
    branch,
    detached,
    dirty,
    notRepo: false,
    ...checkout,
  }
}

/** @type {Map<string, { at: number, value: object }>} */
const cache = new Map()

/** Cached {@link reportFor}. */
async function cachedReport(cwd) {
  const hit = cache.get(cwd)
  const now = Date.now()
  if (hit !== undefined && now - hit.at < CACHE_TTL_MS) return hit.value
  const value = await reportFor(cwd)
  cache.delete(cwd)
  cache.set(cwd, { at: now, value })
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done === true) break
    cache.delete(oldest.value)
  }
  return value
}

/**
 * Every checkout of `cwd`'s repository, and the local branches none of them
 * holds.
 *
 * `git worktree list --porcelain` names the main checkout and each linked
 * worktree with its branch, which is precisely the set a session can be moved
 * to without touching anybody's files.
 *
 * @param cwd - a directory inside the repository.
 */
async function checkoutsFor(cwd) {
  const report = await cachedReport(cwd)
  if (report.notRepo === true) {
    return { ok: true, repoRoot: null, worktreeRoot: null, checkouts: [], branches: [] }
  }
  const root = report.repoRoot
  // Moving a worktree means adding one beside the main checkout, never inside
  // another worktree.
  const mainRoot = report.mainRepoRoot !== null ? report.mainRepoRoot : root

  const listed = []
  const porcelain = await git(root, ['worktree', 'list', '--porcelain'])
  let entry = null
  for (const line of outputLines(porcelain)) {
    const space = line.indexOf(' ')
    const key = space < 0 ? line : line.slice(0, space)
    const value = space < 0 ? '' : line.slice(space + 1)
    if (key === 'worktree') {
      if (entry !== null) listed.push(entry)
      entry = { path: value, branch: null, detached: false, bare: false }
      continue
    }
    if (entry === null) continue
    if (key === 'branch') entry.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'detached') entry.detached = true
    else if (key === 'bare') entry.bare = true
  }
  if (entry !== null) listed.push(entry)

  const rows = listed
    .filter((item) => item.bare !== true)
    .map((item) => ({
      path: item.path,
      name: basename(item.path),
      branch: item.branch,
      detached: item.detached,
      current: samePath(item.path, root),
      main: samePath(item.path, mainRoot),
    }))

  const taken = new Set(rows.map((row) => row.branch).filter((branch) => branch !== null))
  const refs = await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  const branches = outputLines(refs)
    .filter((branch) => !taken.has(branch))
    .map((branch) => ({ name: branch }))

  return {
    ok: true,
    repoRoot: root,
    worktreeRoot: join(mainRoot, WORKTREE_DIR).split(sep).join('/'),
    branch: report.branch,
    checkouts: rows,
    branches,
  }
}

/** Write one JSON reply. */
function respond(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(text))
  res.end(text)
}

/** True when `value` looks like an absolute directory that exists. */
function usableDirectory(value) {
  if (typeof value !== 'string' || value === '' || value.length > CWD_LIMIT) return false
  if (!/^(?:[A-Za-z]:[\\/]|[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(value)) return false
  try {
    return statSync(value).isDirectory()
  } catch {
    return false
  }
}

/** True when `value` can be a branch name this route may create a worktree for. */
function usableBranch(value) {
  if (typeof value !== 'string' || value === '' || value.length > 200) return false
  // Mirrors git's own ref rules closely enough that a crafted value cannot
  // escape the worktree directory or smuggle an option.
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/') || value.endsWith('.lock')) return false
  if (value.includes('..') || value.includes('//') || value.includes('\\')) return false
  if (/[\u0000-\u001f\u007f ~^:?*[\]"'<>|]/.test(value)) return false
  return /^[A-Za-z0-9._/-]+$/.test(value)
}

/** Read and parse a small JSON request body. */
function readJson(req) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        resolve(undefined)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(value !== null && typeof value === 'object' ? value : undefined)
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => resolve(undefined))
  })
}

/**
 * Host services the two POST routes need. Filled in by {@link apply} once the
 * agent and working-directory services are available.
 * @type {{ agentFor: (sessionId: string) => unknown, set: (agent: unknown, path: string) => Promise<string> } | undefined}
 */
let services

/**
 * Directories chosen for sessions whose agent is not running yet — a fresh
 * conversation has no agent until its first message, so the choice is replayed
 * as soon as that agent appears. A choice is dropped after `PENDING_TTL_MS`: a
 * conversation that never starts must not move a directory much later.
 * @type {Map<string, { path: string, at: number }>}
 */
const pendingSwitches = new Map()

/** How long a remembered choice waits for its session to start. */
const PENDING_TTL_MS = 10 * 60 * 1000

/** Drop remembered choices that outlived their wait. */
function prunePending(now) {
  for (const [sessionId, entry] of pendingSwitches) {
    // A half-written entry (or one from an older build) counts as expired.
    if (!(now - entry.at <= PENDING_TTL_MS)) pendingSwitches.delete(sessionId)
  }
}

/**
 * Move a session's working directory, or remember the choice until its agent
 * exists.
 * @param sessionId - the session the page is showing.
 * @param path - an absolute directory that already exists.
 */
async function switchSession(sessionId, path) {
  if (typeof sessionId !== 'string' || sessionId === '') return { ok: false, reason: 'no-session' }
  if (services === undefined) return { ok: false, reason: 'services-missing' }
  prunePending(Date.now())
  const agent = services.agentFor(sessionId)
  if (agent === undefined || agent === null) {
    pendingSwitches.set(sessionId, { path, at: Date.now() })
    return { ok: true, deferred: true, cwd: path }
  }
  const cwd = await services.set(agent, path)
  cache.clear()
  return { ok: true, deferred: false, cwd }
}

/** Apply a remembered directory once its session's agent appears. */
async function applyPending(agent) {
  const sessionId = String(agent.id)
  const entry = pendingSwitches.get(sessionId)
  if (entry === undefined) return
  pendingSwitches.delete(sessionId)
  const path = entry.path
  if (services === undefined) return
  try {
    if (!usableDirectory(path)) return
    await services.set(agent, path)
    cache.clear()
  } catch {
    // A directory that vanished between the click and the agent starting is not
    // worth reporting; the badge keeps describing what git actually answers.
  }
}

/** Route handler: `GET ?cwd=<absolute path>`. */
async function handleStatus(req, res) {
  if ((req.method ?? 'GET') !== 'GET') {
    respond(res, 405, { ok: false, reason: 'method-not-allowed' })
    return
  }
  let query
  try {
    query = new URL(req.url ?? '/', 'http://localhost')
  } catch {
    respond(res, 400, { ok: false, reason: 'bad-url' })
    return
  }
  const cwd = query.searchParams.get('cwd')
  if (cwd === null) {
    respond(res, 200, { ok: true, route: ROUTE, git: gitBinary ?? null })
    return
  }
  if (gitBinary === undefined) await resolveGit()
  if (gitBinary === null) {
    respond(res, 200, { ok: false, reason: 'git-missing', cwd })
    return
  }
  if (!usableDirectory(cwd)) {
    respond(res, 200, { ok: false, reason: 'bad-cwd', cwd })
    return
  }
  try {
    respond(res, 200, { ok: true, ...(await cachedReport(cwd)) })
  } catch (error) {
    respond(res, 200, { ok: false, reason: 'probe-failed', cwd, message: String(error) })
  }
}

/** Route handler: `GET ?cwd=<absolute path>` listing every checkout. */
async function handleCheckouts(req, res) {
  if ((req.method ?? 'GET') !== 'GET') {
    respond(res, 405, { ok: false, reason: 'method-not-allowed' })
    return
  }
  let query
  try {
    query = new URL(req.url ?? '/', 'http://localhost')
  } catch {
    respond(res, 400, { ok: false, reason: 'bad-url' })
    return
  }
  const cwd = query.searchParams.get('cwd')
  if (cwd === null || !usableDirectory(cwd)) {
    respond(res, 400, { ok: false, reason: 'bad-cwd', cwd })
    return
  }
  if (gitBinary === undefined) await resolveGit()
  if (gitBinary === null) {
    respond(res, 200, { ok: false, reason: 'git-missing', cwd })
    return
  }
  try {
    respond(res, 200, await checkoutsFor(cwd))
  } catch (error) {
    respond(res, 200, { ok: false, reason: 'probe-failed', message: String(error) })
  }
}

/** Route handler: `GET` — which sessions this host can move right now. */
async function handleSessions(req, res) {
  if ((req.method ?? 'GET') !== 'GET') {
    respond(res, 405, { ok: false, reason: 'method-not-allowed' })
    return
  }
  const live = services === undefined || typeof services.liveAgents !== 'function' ? null : services.liveAgents()
  prunePending(Date.now())
  respond(res, 200, { ok: true, live, pending: [...pendingSwitches.keys()] })
}

/** Route handler: `POST { sessionId, path }`. */
async function handleSwitch(req, res) {
  if ((req.method ?? 'GET') !== 'POST') {
    respond(res, 405, { ok: false, reason: 'method-not-allowed' })
    return
  }
  const body = await readJson(req)
  if (body === undefined) {
    respond(res, 400, { ok: false, reason: 'bad-body' })
    return
  }
  const path = body.path
  if (!usableDirectory(path)) {
    respond(res, 200, { ok: false, reason: 'bad-path' })
    return
  }
  try {
    respond(res, 200, await switchSession(String(body.sessionId ?? ''), path))
  } catch (error) {
    respond(res, 200, { ok: false, reason: 'switch-failed', message: String(error) })
  }
}

/** Route handler: `POST { sessionId, cwd, branch }`. */
async function handleWorktree(req, res) {
  if ((req.method ?? 'GET') !== 'POST') {
    respond(res, 405, { ok: false, reason: 'method-not-allowed' })
    return
  }
  const body = await readJson(req)
  if (body === undefined) {
    respond(res, 400, { ok: false, reason: 'bad-body' })
    return
  }
  const cwd = body.cwd
  const branch = body.branch
  if (!usableDirectory(cwd)) {
    respond(res, 200, { ok: false, reason: 'bad-cwd' })
    return
  }
  if (!usableBranch(branch)) {
    respond(res, 200, { ok: false, reason: 'bad-branch' })
    return
  }
  if (gitBinary === undefined) await resolveGit()
  if (gitBinary === null) {
    respond(res, 200, { ok: false, reason: 'git-missing' })
    return
  }
  try {
    const report = await cachedReport(cwd)
    if (report.notRepo === true) {
      respond(res, 200, { ok: false, reason: 'not-repo' })
      return
    }
    const mainRoot = report.mainRepoRoot !== null ? report.mainRepoRoot : report.repoRoot
    const known = await git(mainRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    if (known === undefined || known === '') {
      respond(res, 200, { ok: false, reason: 'no-such-branch' })
      return
    }
    const target = resolve(mainRoot, WORKTREE_DIR, branch)
    const prefix = resolve(mainRoot) + sep
    if (!resolve(target).startsWith(prefix)) {
      respond(res, 200, { ok: false, reason: 'bad-branch' })
      return
    }
    if (existsSync(target)) {
      respond(res, 200, { ok: false, reason: 'exists', path: target })
      return
    }
    // git creates the leaf directory but not its parents, and `feat/x` puts the
    // leaf two levels down.
    try {
      mkdirSync(dirname(target), { recursive: true })
    } catch {
      respond(res, 200, { ok: false, reason: 'mkdir-failed', path: dirname(target) })
      return
    }
    const added = await git(mainRoot, ['worktree', 'add', target, branch], WORKTREE_TIMEOUT_MS)
    if (added === undefined) {
      respond(res, 200, { ok: false, reason: 'worktree-add-failed' })
      return
    }
    cache.clear()
    const moved = await switchSession(String(body.sessionId ?? ''), target)
    respond(res, 200, { ok: moved.ok === true, path: target, ...moved })
  } catch (error) {
    respond(res, 200, { ok: false, reason: 'worktree-failed', message: String(error) })
  }
}

/**
 * Switch branches inside the session's current checkout: the directory stays,
 * the branch changes. Refuses to guess — anything git will not do comes back as
 * git's own words, because a dirty tree or a branch already checked out in
 * another worktree are the normal cases here, not errors in this plugin.
 */
async function handleCheckout(req, res) {
  if ((req.method ?? 'GET') !== 'POST') {
    respond(res, 405, { ok: false, reason: 'method-not-allowed' })
    return
  }
  const body = await readJson(req)
  if (body === undefined) {
    respond(res, 400, { ok: false, reason: 'bad-body' })
    return
  }
  const cwd = body.cwd
  const branch = body.branch
  if (!usableDirectory(cwd)) {
    respond(res, 200, { ok: false, reason: 'bad-cwd' })
    return
  }
  if (!usableBranch(branch)) {
    respond(res, 200, { ok: false, reason: 'bad-branch' })
    return
  }
  if (gitBinary === undefined) await resolveGit()
  if (gitBinary === null) {
    respond(res, 200, { ok: false, reason: 'git-missing' })
    return
  }
  try {
    const report = await cachedReport(cwd)
    if (report.notRepo === true) {
      respond(res, 200, { ok: false, reason: 'not-repo' })
      return
    }
    const root = report.repoRoot
    if (report.branch === branch) {
      respond(res, 200, { ok: true, branch, path: root, unchanged: true })
      return
    }
    const known = await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    if (known === undefined || known === '') {
      respond(res, 200, { ok: false, reason: 'no-such-branch' })
      return
    }
    const run = await gitRun(root, ['checkout', branch], WORKTREE_TIMEOUT_MS)
    if (run.ok !== true) {
      respond(res, 200, {
        ok: false,
        reason: 'checkout-failed',
        message: gitComplaint(run.stderr !== '' ? run.stderr : run.stdout),
      })
      return
    }
    cache.clear()
    respond(res, 200, { ok: true, branch, path: root })
  } catch (error) {
    respond(res, 200, { ok: false, reason: 'checkout-failed', message: String(error) })
  }
}

/** Internals exposed for the package's own smoke test; not a public contract. */
export const __internals = {
  reportFor,
  checkoutsFor,
  handleStatus,
  handleCheckouts,
  handleSwitch,
  handleWorktree,
  handleCheckout,
  handleSessions,
  resolveGit,
  usableDirectory,
  usableBranch,
  gitCandidates,
}

/**
 * Mount the four routes and wire the working-directory service.
 * @param ctx - host root context.
 */
export function apply(ctx) {
  ctx.effect(() => {
    // Resolve the binary once in the background; a request that arrives first
    // waits for the same probe instead of starting a second one.
    resolveGit().catch(() => {})
    return () => {
      cache.clear()
      pendingSwitches.clear()
    }
  }, 'dsh-cwd-branch: git probe')

  // The two POST routes move sessions, which only this service can do: a
  // session's directory belongs to its live agent, so the choice waits for the
  // agent when the conversation has not started yet.
  ctx.inject(['agents', 'workingDirectory'], (serviceCtx) => {
    const agents = serviceCtx.agents
    const directories = serviceCtx.workingDirectory
    services = {
      agentFor: (sessionId) => (agents === undefined || agents === null ? undefined : agents.get(sessionId)),
      set: (agent, path) => directories.set(agent, path),
      // Diagnostics: which sessions this host holds a live agent for, and whose
      // switch is waiting for one. Read-only.
      liveAgents: () => {
        const store = agents === undefined || agents === null ? undefined : agents.store
        if (store === undefined || store === null || typeof store.keys !== 'function') return null
        return [...store.keys()]
      },
    }
    serviceCtx.effect(() => {
      const off = serviceCtx.on('agent/created', ({ agent }) => {
        applyPending(agent).catch(() => {})
      })
      return () => {
        services = undefined
        if (typeof off === 'function') off()
      }
    }, 'dsh-cwd-branch: pending working directories')
  })

  ctx.inject(['webServer'], (webCtx) => {
    const routes = [
      { path: ROUTE, handler: handleStatus, label: 'status' },
      { path: CHECKOUTS_ROUTE, handler: handleCheckouts, label: 'checkouts' },
      { path: SWITCH_ROUTE, handler: handleSwitch, label: 'switch' },
      { path: WORKTREE_ROUTE, handler: handleWorktree, label: 'worktree' },
      { path: CHECKOUT_ROUTE, handler: handleCheckout, label: 'checkout' },
      { path: SESSIONS_ROUTE, handler: handleSessions, label: 'sessions' },
    ]
    for (const route of routes) {
      webCtx.effect(
        () => webCtx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }),
        `dsh-cwd-branch: ${route.label} route`,
      )
    }
  })
}
