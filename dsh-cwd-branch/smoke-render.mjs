// Renders the browser half's pill against stubbed host replies, so the text and
// the click paths the user actually uses are asserted rather than only the slot
// registration.
//
//   node smoke-render.mjs
//
// react is replaced by a minimal hook harness: state cells persist across
// passes, effects run once per dependency change, and the component is called
// again until a pass renders without state changes (max 30 passes). A click is
// simulated by calling the element's own onClick and settling again, so the
// assertions run through the same code the page runs.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

/** Answers keyed by route, replaced per case. */
const answers = { status: null, checkouts: null, switch: null, worktree: null, checkout: null }
/** POST bodies the component sent, in order. */
const posts = []

const cells = []
let cursor = 0
let dirty = false
let pendingEffects = []
const effectState = new Map()

const React = {
  createElement(type, properties, ...children) {
    const props = { ...(properties === null || properties === undefined ? {} : properties) }
    if (children.length === 1) props.children = children[0]
    else if (children.length > 1) props.children = children
    return { type, props }
  },
  useState(initial) {
    const index = cursor++
    if (!(index in cells)) cells[index] = { value: typeof initial === 'function' ? initial() : initial }
    const cell = cells[index]
    const set = (next) => {
      const value = typeof next === 'function' ? next(cell.value) : next
      if (!Object.is(value, cell.value)) {
        cell.value = value
        dirty = true
      }
    }
    return [cell.value, set]
  },
  useEffect(fn, deps) {
    const index = cursor++
    pendingEffects.push({ index, fn, deps })
  },
  useMemo(fn) {
    const index = cursor++
    if (!(index in cells)) cells[index] = { value: fn() }
    return cells[index].value
  },
  useRef(initial) {
    const index = cursor++
    if (!(index in cells)) cells[index] = { value: { current: initial } }
    return cells[index].value
  },
}

/** A stand-in for the pill element the menu is positioned against. */
const pillNode = {
  getBoundingClientRect: () => ({ left: 120, top: 700, right: 420, bottom: 724, width: 300, height: 24 }),
  contains: () => false,
}

const listeners = new Map()
const documentStub = {
  baseURI: 'http://127.0.0.1:55921/',
  head: { appendChild() {} },
  body: { appendChild() {}, removeChild() {} },
  createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }),
  getElementById: () => null,
  execCommand: () => true,
  addEventListener(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(fn)
  },
  removeEventListener(type, fn) {
    if (listeners.has(type)) listeners.get(type).delete(fn)
  },
}

let loaded = null
const windowStub = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loaded = { id, exports: factory(requireStub) }
    },
  },
  innerWidth: 1200,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
}

const portals = []
function requireStub(name) {
  if (name === 'react') return React
  if (name === 'react-dom') {
    return {
      createPortal(node, target) {
        portals.push(target)
        return node
      },
    }
  }
  throw new Error(`no seed ${name}`)
}

const navigatorStub = { language: 'zh-CN' }
const realSetInterval = globalThis.setInterval
const realSetTimeout = globalThis.setTimeout
const intervals = []
const countingSetInterval = (...args) => {
  const handle = realSetInterval(...args)
  intervals.push(handle)
  return handle
}

/** Route the component's fetches to the answers set for the current case. */
function fetchStub(url, options = {}) {
  const text = String(url)
  const body = options !== null && typeof options.body === 'string' ? JSON.parse(options.body) : null
  let answer
  if (text.includes('/checkouts')) answer = answers.checkouts
  else if (text.includes('/switch')) {
    posts.push({ route: 'switch', body })
    answer = answers.switch
  } else if (text.includes('/checkout')) {
    posts.push({ route: 'checkout', body })
    answer = answers.checkout
  } else if (text.includes('/worktree')) {
    posts.push({ route: 'worktree', body })
    answer = answers.worktree
  } else answer = answers.status
  return Promise.resolve({ ok: true, json: () => Promise.resolve(answer) })
}

// The bundle registers itself against window.__ModuleLoader__ on load, the way
// dsh-client-modules loads it in the page. Every browser global it touches is
// handed to it as a parameter, so the real process globals stay untouched.
const run = new Function('window', 'document', 'navigator', 'fetch', 'setInterval', 'setTimeout', source)
run(windowStub, documentStub, navigatorStub, fetchStub, countingSetInterval, realSetTimeout)

if (!loaded) throw new Error('the bundle did not load')
const registered = []
loaded.exports.apply({
  effect: (fn) => fn(),
  slots: {
    inject: (name, fn) => {
      fn()
      return name
    },
    register: (options, component) => {
      registered.push({ options, component })
      return options.id
    },
  },
})

if (registered.length !== 1) throw new Error(`expected one slot entry, got ${registered.length}`)
const entry = registered[0]
const Component = entry.component

/** Text of a rendered tree, in document order. */
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props.children)
}

/** Every element of a rendered tree, depth first. */
function elementsOf(node, found = []) {
  if (node === null || node === undefined || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) elementsOf(child, found)
    return found
  }
  if (node.props !== undefined) found.push(node)
  elementsOf(node.props === undefined ? undefined : node.props.children, found)
  return found
}

/** The first element whose className contains `name`. */
function byClass(tree, name) {
  return elementsOf(tree).find((element) => String(element.props.className || '').includes(name)) ?? null
}

/** Attach the fake pill node to whatever carries the component's ref. */
function attachRef(node) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) attachRef(child)
    return
  }
  const ref = node.props === undefined ? undefined : node.props.ref
  if (ref !== null && typeof ref === 'object' && 'current' in ref) ref.current = pillNode
  attachRef(node.props === undefined ? undefined : node.props.children)
}

/** Call the component until it stops changing state. */
async function settle(props) {
  let tree = null
  for (let pass = 0; pass < 30; pass++) {
    cursor = 0
    dirty = false
    pendingEffects = []
    tree = Component(props)
    attachRef(tree)
    for (const effect of pendingEffects) {
      const previous = effectState.get(effect.index)
      const same =
        previous !== undefined &&
        Array.isArray(effect.deps) &&
        Array.isArray(previous.deps) &&
        effect.deps.length === previous.deps.length &&
        effect.deps.every((dep, at) => Object.is(dep, previous.deps[at]))
      if (same) continue
      if (previous !== undefined && typeof previous.cleanup === 'function') previous.cleanup()
      const cleanup = effect.fn()
      effectState.set(effect.index, { deps: effect.deps, cleanup })
    }
    // Let the host reply land before deciding the tree is final.
    for (let tick = 0; tick < 40; tick++) await Promise.resolve()
    if (!dirty) return tree
  }
  throw new Error('the component never settled')
}

/** Settle after a simulated click. */
async function afterClick(props, element) {
  // A missing element used to surface as `cannot read props of undefined` far
  // from the selector that missed; name the miss here instead.
  if (element === null || element === undefined || element.props === undefined) {
    throw new Error(`afterClick: nothing to click (${element === null ? 'null' : String(element)})`)
  }
  element.props.onClick({ stopPropagation() {}, preventDefault() {} })
  return settle(props)
}

function propsFor(listedCwd, projection) {
  return {
    sessionId: 's1',
    useProjection: (key) => (key === 'workingDirectory' ? projection : undefined),
    useSessions: (select) => select({ byId: { s1: { cwd: listedCwd } } }),
    useSession: (select) => select({ cwd: listedCwd }),
  }
}

/** A host status reply for the given checkout. */
function statusOf(path, overrides = {}) {
  return {
    ok: true,
    cwd: path,
    repoRoot: path,
    branch: 'feat/quotation-module',
    detached: false,
    dirty: false,
    notRepo: false,
    isWorktree: false,
    worktreeName: null,
    mainRepoRoot: null,
    mainRepo: null,
    subPath: null,
    ...overrides,
  }
}

const checkoutsReply = {
  ok: true,
  repoRoot: 'D:/github/fdm-crm',
  worktreeRoot: 'D:/github/fdm-crm/.agents/worktrees',
  branch: 'feat/quotation-module',
  checkouts: [
    {
      path: 'D:/github/fdm-crm',
      name: 'fdm-crm',
      branch: 'fix/self02-wflx-by-ypys',
      detached: false,
      current: false,
      main: true,
    },
    {
      path: 'D:/github/fdm-crm/.agents/worktrees/feat/quotation-module',
      name: 'quotation-module',
      branch: 'feat/quotation-module',
      detached: false,
      current: true,
      main: false,
    },
    {
      path: 'D:/github/fdm-crm/.agents/worktrees/feat/order-module',
      name: 'order-module',
      branch: 'feat/order-module',
      detached: false,
      current: false,
      main: false,
    },
  ],
  branches: [{ name: 'main' }, { name: 'crm_gkk' }],
}

const cases = [
  {
    name: 'linked worktree',
    cwd: 'D:\\github\\fdm-crm\\.agents\\worktrees\\feat\\quotation-module',
    reply: statusOf('D:\\github\\fdm-crm\\.agents\\worktrees\\feat\\quotation-module', {
      repoRoot: 'D:/github/fdm-crm/.agents/worktrees/feat/quotation-module',
      branch: 'feat/quotation-module',
      dirty: true,
      isWorktree: true,
      worktreeName: 'quotation-module',
      mainRepoRoot: 'D:/github/fdm-crm',
      mainRepo: 'fdm-crm',
    }),
    wantLabel: 'quotation-module',
    wantBranch: 'feat/quotation-module',
    wantTitle: ['git worktree，主仓库 D:/github/fdm-crm', '有未提交的改动'],
  },
  {
    name: 'moved into a worktree',
    // A conversation keeps the header cwd it was created with, and the agent can
    // move into a worktree afterwards — the live order-module case. The pill has
    // to follow the workingDirectory projection, not the recorded header cwd.
    listedCwd: 'D:\\github\\fdm-crm',
    projection: 'D:\\github\\fdm-crm\\.agents\\worktrees\\feat\\order-module',
    cwd: 'D:\\github\\fdm-crm\\.agents\\worktrees\\feat\\order-module',
    reply: statusOf('D:\\github\\fdm-crm\\.agents\\worktrees\\feat\\order-module', {
      repoRoot: 'D:/github/fdm-crm/.agents/worktrees/feat/order-module',
      branch: 'feat/order-module',
      isWorktree: true,
      worktreeName: 'order-module',
      mainRepoRoot: 'D:/github/fdm-crm',
      mainRepo: 'fdm-crm',
    }),
    wantLabel: 'order-module',
    wantBranch: 'feat/order-module',
    wantTitle: ['git worktree，主仓库 D:/github/fdm-crm'],
    wantMissing: ['fix/self02-wflx-by-ypys'],
  },
  {
    name: 'worktree subdirectory',
    cwd: 'D:\\github\\fdm-crm\\.agents\\worktrees\\feat\\quotation-module\\src',
    reply: statusOf('D:\\github\\fdm-crm\\.agents\\worktrees\\feat\\quotation-module\\src', {
      repoRoot: 'D:/github/fdm-crm/.agents/worktrees/feat/quotation-module',
      isWorktree: true,
      worktreeName: 'quotation-module',
      mainRepoRoot: 'D:/github/fdm-crm',
      mainRepo: 'fdm-crm',
      subPath: 'src',
    }),
    wantLabel: 'quotation-module/src',
    wantBranch: 'feat/quotation-module',
    wantTitle: ['位于 D:/github/fdm-crm/.agents/worktrees/feat/quotation-module'],
  },
  {
    name: 'main checkout',
    cwd: 'D:\\github\\fdm-crm',
    reply: statusOf('D:\\github\\fdm-crm', { repoRoot: 'D:/github/fdm-crm', branch: 'fix/self02-wflx-by-ypys' }),
    wantLabel: 'fdm-crm',
    wantBranch: 'fix/self02-wflx-by-ypys',
    wantTitle: [],
    wantMissing: ['›'],
  },
  {
    name: 'not a repository',
    cwd: 'D:\\dsh',
    reply: { ok: true, cwd: 'D:\\dsh', repoRoot: null, branch: null, detached: false, dirty: false, notRepo: true },
    wantLabel: 'dsh',
    wantBranch: '无分支',
    wantTitle: ['不是 git 仓库'],
  },
]

let failures = 0
function check(name, problems, detail) {
  if (problems.length === 0) {
    console.log(`ok   ${name}`)
    return
  }
  failures += 1
  console.log(`FAIL ${name}: ${problems.join('; ')}\n     ${detail}`)
}

/** Reset the harness for a new case. */
function reset() {
  effectState.clear()
  cells.length = 0
  posts.length = 0
  answers.status = null
  answers.checkouts = null
  answers.switch = null
  answers.worktree = null
}

for (const test of cases) {
  reset()
  answers.status = test.reply
  const tree = await settle(propsFor(test.listedCwd ?? test.cwd, test.projection ?? test.cwd))
  const text = textOf(tree)
  const label = textOf(byClass(tree, 'dsh-cb-path'))
  const branchText = textOf(byClass(tree, 'dsh-cb-branchname'))
  const copyTitle = String((byClass(tree, 'dsh-cb-copy') ?? { props: {} }).props.title || '')
  const branchTitle = String((byClass(tree, 'dsh-cb-branch') ?? { props: {} }).props.title || '')
  const problems = []
  if (test.wantLabel !== undefined && label !== test.wantLabel)
    problems.push(`label is ${JSON.stringify(label)}, wanted ${JSON.stringify(test.wantLabel)}`)
  if (test.wantBranch !== undefined && branchText !== String(test.wantBranch))
    problems.push(`branch is ${JSON.stringify(branchText)}, wanted ${JSON.stringify(test.wantBranch)}`)
  for (const needle of test.wantTitle) {
    if (!copyTitle.includes(needle) && !branchTitle.includes(needle)) problems.push(`tooltip is missing ${JSON.stringify(needle)}`)
  }
  for (const needle of test.wantMissing || []) if (text.includes(needle)) problems.push(`text should not contain ${JSON.stringify(needle)}`)
  check(`${test.name.padEnd(24)} label=${JSON.stringify(label)} branch=${JSON.stringify(branchText)}`, problems, `text=${JSON.stringify(text)}`)
}

// --- the copy segment copies the directory -----------------------------------
{
  reset()
  answers.status = cases[3].reply
  const props = propsFor(cases[3].cwd, cases[3].cwd)
  let tree = await settle(props)
  tree = await afterClick(props, byClass(tree, 'dsh-cb-copy'))
  const label = textOf(byClass(tree, 'dsh-cb-path'))
  check('copy segment', label === '已复制' ? [] : [`label is ${JSON.stringify(label)} after clicking copy`], `text=${JSON.stringify(textOf(tree))}`)
}

// --- the branch segment opens the menu, and a checkout item switches ---------
{
  reset()
  answers.status = cases[3].reply
  answers.checkouts = checkoutsReply
  answers.switch = { ok: true, deferred: false, cwd: 'D:/github/fdm-crm/.agents/worktrees/feat/order-module' }
  const props = propsFor(cases[3].cwd, cases[3].cwd)
  let tree = await settle(props)
  tree = await afterClick(props, byClass(tree, 'dsh-cb-branch'))

  const menu = byClass(tree, 'dsh-cb-menu')
  const menuText = textOf(menu)
  const problems = []
  if (menu === null) problems.push('the menu did not open')
  for (const needle of ['切换工作目录', '检出（主仓库与工作树）', '其他分支（点击即切换）', 'fdm-crm', 'order-module', 'main', 'crm_gkk', '✓']) {
    if (!menuText.includes(needle)) problems.push(`menu is missing ${JSON.stringify(needle)}`)
  }
  const items = elementsOf(menu).filter((element) => String(element.props.className || '') === 'dsh-cb-item')
  const current = items.filter((element) => element.props['data-current'] === 'true')
  if (current.length !== 1) problems.push(`expected one current item, got ${current.length}`)
  check('menu lists checkouts and branches', problems, `menu=${JSON.stringify(menuText)}`)

  // The panel follows the pill: its left edge matches the pill's, it sits 6px
  // above it, and it never grows taller than the room above the composer.
  const style = menu === null ? {} : menu.props.style || {}
  const placeProblems = []
  if (style.left !== '120px') placeProblems.push(`left is ${JSON.stringify(style.left)}, expected 120px`)
  if (style.bottom !== '206px') placeProblems.push(`bottom is ${JSON.stringify(style.bottom)}, expected 206px (900-700+6)`)
  if (style.width !== '320px') placeProblems.push(`width is ${JSON.stringify(style.width)}, expected 320px`)
  if (style.maxHeight !== '360px') placeProblems.push(`maxHeight is ${JSON.stringify(style.maxHeight)}, expected 360px`)
  check('menu follows the pill', placeProblems, `style=${JSON.stringify(style)}`)

  check(
    'the menu is portalled out of the composer row',
    portals.length === 1 && portals[0] === documentStub.body ? [] : [`portals=${portals.length} target=${String(portals[0])}`],
    '',
  )

  // Pick the order-module worktree.
  const target = items.find((element) => textOf(element).includes('order-module'))
  const after = await afterClick(props, target)
  const problems2 = []
  const sent = posts.find((entry) => entry.route === 'switch')
  if (sent === undefined) problems2.push('no /switch POST was sent')
  else {
    if (sent.body.sessionId !== 's1') problems2.push(`sessionId is ${JSON.stringify(sent.body.sessionId)}`)
    if (sent.body.path !== 'D:/github/fdm-crm/.agents/worktrees/feat/order-module')
      problems2.push(`path is ${JSON.stringify(sent.body.path)}`)
  }
  if (byClass(after, 'dsh-cb-menu') !== null) problems2.push('the menu stayed open')
  if (!textOf(after).includes('已切换')) problems2.push(`no success notice: ${JSON.stringify(textOf(after))}`)
  check('clicking a checkout switches the session', problems2, `posts=${JSON.stringify(posts)} text=${JSON.stringify(textOf(after))}`)
}

// --- a free branch checks out in place, with no second click ------------------
// A branch listed under "分支" has no checkout of its own, so the click itself
// runs `git checkout` where the session already sits: no confirmation step and
// no worktree creation. git's own refusal (dirty tree, branch tied to another
// worktree) is what the host reports back.
{
  reset()
  answers.status = cases[3].reply
  answers.checkouts = checkoutsReply
  answers.checkout = { ok: true }
  const props = propsFor(cases[3].cwd, cases[3].cwd)
  let tree = await settle(props)
  tree = await afterClick(props, byClass(tree, 'dsh-cb-branch'))

  const items = elementsOf(tree).filter((element) => String(element.props.className || '') === 'dsh-cb-item')
  const free = items.find((element) => textOf(element).includes('crm_gkk'))
  const after = await afterClick(props, free)
  const problems = []
  const sent = posts.find((entry) => entry.route === 'checkout')
  if (sent === undefined) problems.push('no /checkout POST was sent')
  else {
    if (sent.body.branch !== 'crm_gkk') problems.push(`branch is ${JSON.stringify(sent.body.branch)}`)
    if (sent.body.cwd !== 'D:\\github\\fdm-crm') problems.push(`cwd is ${JSON.stringify(sent.body.cwd)}`)
    if (sent.body.sessionId !== 's1') problems.push(`sessionId is ${JSON.stringify(sent.body.sessionId)}`)
  }
  if (byClass(after, 'dsh-cb-menu') !== null) problems.push('the menu stayed open')
  if (!textOf(after).includes('已切到 crm_gkk')) problems.push(`no checkout notice: ${JSON.stringify(textOf(after))}`)
  check('a free branch checks out in place', problems, `posts=${JSON.stringify(posts)} text=${JSON.stringify(textOf(after))}`)
}

// --- a refused switch says so ------------------------------------------------
{
  reset()
  answers.status = cases[3].reply
  answers.checkouts = checkoutsReply
  answers.switch = { ok: false, reason: 'bad-path' }
  const props = propsFor(cases[3].cwd, cases[3].cwd)
  let tree = await settle(props)
  tree = await afterClick(props, byClass(tree, 'dsh-cb-branch'))
  const items = elementsOf(tree).filter((element) => String(element.props.className || '') === 'dsh-cb-item')
  const target = items.find((element) => textOf(element).includes('order-module'))
  const after = await afterClick(props, target)
  check('a refused switch reports the failure', textOf(after).includes('切换失败') ? [] : [`text=${JSON.stringify(textOf(after))}`], '')
}

for (const handle of intervals) clearInterval(handle)
if (failures > 0) {
  console.log(`\n${failures} case(s) failed`)
  process.exit(1)
}
console.log('\nall cases passed')
process.exit(0)
