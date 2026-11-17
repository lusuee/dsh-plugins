// Smoke test for the browser half: run the bundle the way the page does
// (window.__ModuleLoader__.load with a CJS factory), with react stubbed and a
// recording slots service, then check the registration.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')

const fakeReact = {
  createElement: (type, props, children) => ({ type, props, children }),
  useMemo: (compute) => compute(),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
}

let loaded = null
const sandbox = {
  console,
  URL,
  Symbol,
  Object,
  Date,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  AbortController,
  window: {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        loaded = { id, exports: factory((specifier) => (specifier === 'react' ? fakeReact : undefined)) }
      },
    },
  },
}

vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

if (loaded === null) throw new Error('the bundle did not register a module')
console.log('module id =', loaded.id, '| inject =', JSON.stringify(loaded.exports.inject))

const registrations = []
const ctx = {
  slots: {
    inject: (name, register) => {
      registrations.push({ via: 'inject', name })
      return register()
    },
    register: (options, component) => {
      registrations.push({ via: 'register', options })
      return typeof component
    },
  },
  effect: (factory, label) => {
    registrations.push({ via: 'effect', label })
    return factory()
  },
}

loaded.exports.apply(ctx)
console.log(JSON.stringify(registrations, null, 2))
