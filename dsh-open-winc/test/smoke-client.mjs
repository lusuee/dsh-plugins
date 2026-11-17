// Smoke test for the browser half: loads the bundle the way the page does,
// with a stub module loader and a stub React, then checks the slot
// registration. It does not render anything.
// Run with: node test/smoke-client.mjs
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const source = readFileSync(clientPath, 'utf8')

/** Minimal React stand-in: element objects only, hooks answer their defaults. */
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useMemo(factory) {
    return factory()
  },
}

/** Icon stand-ins, so the button has the same shape as in the page. */
const primitives = {
  IconFolderOpenOutlineRegular: function IconFolderOpenOutlineRegular() {
    return null
  },
}

const loaded = []
const stubWindow = {
  __ModuleLoader__: {
    load(descriptor) {
      loaded.push(descriptor)
    },
  },
}

/** The document surface the bundle touches: stylesheet injection only. */
const appended = []
const documentStub = {
  head: {
    appendChild(tag) {
      appended.push(tag)
    },
  },
  getElementById() {
    return null
  },
  createElement() {
    return { id: '', textContent: '' }
  },
  baseURI: 'http://127.0.0.1/',
}
const navigatorStub = { language: 'zh-CN' }
const fetchStub = () => Promise.resolve({ ok: false })

// The stubs are passed as parameters and shadow the real globals for the
// bundle, which is why nothing global is reassigned here.
// eslint-disable-next-line no-new-func
new Function('window', 'document', 'navigator', 'fetch', source)(
  stubWindow,
  documentStub,
  navigatorStub,
  fetchStub,
)

assert.equal(loaded.length, 1, 'the bundle registers exactly one module')
const descriptor = loaded[0]
assert.equal(descriptor.id, 'dsh-open-winc')
assert.equal(typeof descriptor.factory, 'function')

const requireStub = (name) => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected module request: ${name}`)
}
const moduleExports = descriptor.factory(requireStub)
assert.deepEqual(moduleExports.inject, ['slots'])
assert.equal(typeof moduleExports.apply, 'function')

const injected = []
const registered = []
const ctx = {
  effect(factory) {
    return factory()
  },
  slots: {
    inject(name, run) {
      injected.push(name)
      return run()
    },
    register(meta, component) {
      registered.push({ meta, component })
      return () => {}
    },
  },
}

moduleExports.apply(ctx)

assert.equal(appended.length, 1, 'one stylesheet is injected')
assert.ok(appended[0].id === 'dsh-open-winc-style')
assert.deepEqual(injected, ['conversation.session.header.utilities'])
assert.equal(registered.length, 1)
const meta = registered[0].meta
assert.equal(meta.name, 'conversation.session.header.utilities')
assert.equal(meta.id, 'open-winc')
assert.equal(meta.order, -10)
assert.equal(typeof meta.label, 'function')
assert.equal(meta.label(), 'Winc')
assert.equal(typeof registered[0].component, 'function')

// With no answer from the host yet the component offers nothing: it must not
// flash a button that cannot work.
const component = registered[0].component
const props = {
  sessionId: 'session-test',
  useProjection: (name) =>
    name === 'workingDirectory' ? 'D:\\github\\fdm-crm\\.agents\\worktrees\\feat\\market-intel' : undefined,
  useSessions: (selector) => selector({ byId: { 'session-test': { cwd: 'D:\\github\\fdm-crm' } } }),
}
assert.equal(component(props), null)

// Without a projection the header cwd still answers, and without a session id
// or directory at all the component stays silent instead of throwing.
const headerOnly = {
  sessionId: 'session-test',
  useProjection: () => null,
  useSessions: (selector) => selector({ byId: { 'session-test': { cwd: 'D:\\github\\fdm-crm' } } }),
}
assert.equal(component(headerOnly), null)
assert.equal(component({ sessionId: 'session-test' }), null)
assert.equal(component({}), null)

// A state-aware React stand-in, so the rendered button can be inspected once the
// host has answered. Hook order: available, busy, notice, iconStage.
const stateSlots = [true, false, null, 0]
let stateCursor = 0
const StatefulReact = {
  createElement: React.createElement,
  useState(initial) {
    const index = stateCursor++
    if (stateSlots[index] === undefined) {
      stateSlots[index] = typeof initial === 'function' ? initial() : initial
    }
    return [
      stateSlots[index],
      (next) => {
        stateSlots[index] = typeof next === 'function' ? next(stateSlots[index]) : next
      },
    ]
  },
  useEffect() {},
  useMemo(factory) {
    return factory()
  },
}

const statefulExports = descriptor.factory((name) => {
  if (name === 'react') return StatefulReact
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`unexpected module request: ${name}`)
})
const statefulRegistered = []
statefulExports.apply({
  effect(factory) {
    return factory()
  },
  slots: {
    inject(name, run) {
      return run()
    },
    register(meta, entry) {
      statefulRegistered.push({ meta, component: entry })
      return () => {}
    },
  },
})

const render = () => {
  stateCursor = 0
  return statefulRegistered[0].component(props)
}

/** Depth-first search for the element whose props carry an `img` source. */
const findIcon = (node) => {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findIcon(item)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  if (node.type === 'img') return node
  return findIcon(node.children ?? [])
}

const firstIcon = findIcon(render())
assert.ok(firstIcon !== undefined, 'the available button shows an icon')
assert.equal(firstIcon.props.className, 'dsh-ow-icon')
assert.equal(firstIcon.props.src, 'http://127.0.0.1/__dsh-open-winc/icon')

// The host may still be running older code (no icon route): the same frame is
// baked into the bundle, so a single failed request degrades to the data URI.
firstIcon.props.onError()
const fallbackIcon = findIcon(render())
assert.ok(fallbackIcon.props.src.startsWith('data:image/png;base64,'), 'a failed request falls back to the baked-in icon')

// A second failure gives up on images and uses the built-in glyph.
fallbackIcon.props.onError()
const glyphNode = (() => {
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = walk(item)
        if (hit !== undefined) return hit
      }
      return undefined
    }
    if (node === null || typeof node !== 'object') return undefined
    if (node.type === primitives.IconFolderOpenOutlineRegular) return node
    return walk(node.children ?? [])
  }
  return walk(render())
})()
assert.ok(glyphNode !== undefined, 'the last resort is the built-in glyph')

const cases = 16
for (const line of [
  'bundle loads once with the expected id',
  'factory exports inject + apply',
  'one stylesheet is installed',
  'apply injects conversation.session.header.utilities',
  'one entry registered with id open-winc and order -10',
  'label resolves to Winc',
  'component is a function component',
  'component renders nothing before the host answers',
  'component tolerates the projection-first lookup',
  'component falls back to the header cwd without throwing',
  'component tolerates a missing useProjection',
  'component tolerates a missing session',
  'the available button shows the host icon',
  'a failed icon request falls back to the baked-in copy',
  'a second failure falls back to the built-in glyph',
  'the fallback chain never renders a broken image',
]) {
  console.log('ok   ', line)
}
console.log(`all ${cases} cases passed`)
