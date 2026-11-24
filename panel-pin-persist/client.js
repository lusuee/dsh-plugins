/**
 * Panel pin persistence: re-registers the `sidebar` slot one priority step
 * below the stock registration (lowest renders, original component) with the
 * stock injected props wrapped so that the pin list is read from and written
 * to localStorage.
 *
 * Stock behavior being shadowed: @deepseek-ai/dsh-client-ui-sidebar keeps the
 * unpinned-panel list in a memory-only snapshot store (panel-pins.ts), so
 * every restart forgets which panel launchers were unpinned.
 *
 * Two mechanisms are installed for the same purpose, because the renderer's
 * inject plumbing is version-specific: (a) the stock entry's own inject face
 * is patched in place, (b) a priority -1 shadow entry is registered. Whichever
 * the renderer honors, `setPinned` is the persisted one.
 *
 * Diagnostics land in localStorage under `dsh.panel-pins.diag`; the client
 * bundle has no other Host-side channel.
 */
window.__ModuleLoader__.load({
  id: '@local/panel-pin-persist',
  factory() {
    const STORAGE_KEY = 'dsh.panel-pins.unpinned.v1'
    const DIAG_KEY = 'dsh.panel-pins.diag'
    const FIXED_PANEL_ID = 'plugins'
    const NS = 'sidebar'

    const stamp = () => new Date().toISOString().slice(11, 23)

    const diag = (step, info) => {
      try {
        const raw = localStorage.getItem(DIAG_KEY)
        let list = []
        if (raw) {
          try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) list = parsed
          } catch { list = [] }
        }
        list.push({ t: stamp(), step, info: info === undefined ? null : info })
        localStorage.setItem(DIAG_KEY, JSON.stringify(list.slice(-80)))
      } catch { /* diagnostics only */ }
    }

    diag('bundle')

    /** Reference-stable snapshot store (the subset of createSnapshotStore used here). */
    function createSnapshotStore(state) {
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        set(next) {
          if (next === state) return
          state = next
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    function loadPersisted() {
      try {
        if (typeof localStorage === 'undefined') return []
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter((id) => typeof id === 'string')
      } catch {
        return []
      }
    }

    function persist(list) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
      } catch { /* storage unavailable: behave like the stock in-memory pins */ }
    }

    /** The stock PanelPins face, backed by localStorage. */
    function createPanelPins() {
      const store = createSnapshotStore({ unpinned: loadPersisted() })
      return {
        store,
        unpinned: {
          getSnapshot: () => store.getSnapshot().unpinned,
          subscribe: (listener) => store.subscribe(listener),
        },
        setPinned: (id, pinned) => {
          const current = store.getSnapshot().unpinned
          const isUnpinned = current.includes(id)
          if (id === FIXED_PANEL_ID || pinned === !isUnpinned) {
            diag('setPinned-skip', { id, pinned })
            return
          }
          const next = pinned ? current.filter((entry) => entry !== id) : [...current, id]
          diag('setPinned', { id, pinned, next })
          store.set({ unpinned: next })
          persist(next)
        },
      }
    }

    /** Children table from the stock registration; only used when nothing declared them. */
    const FALLBACK_CHILDREN = {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'sidebar.toggle.badge': { kind: 'single', scope: 'root' },
      'sidebar.panellist.actions': { kind: 'list', scope: 'root' },
      'sidebar.workspaces': {
        kind: 'single', scope: 'root',
        inject: { hooks: { sectionScroller: (_standard, { useSectionScroller }) => useSectionScroller } },
      },
      'sidebar.settings': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'sidebar.session.action': { kind: 'hoc', scope: 'root' },
    }

    return {
      inject: ['slots', 'layout', 'uiWorkspace', 'locale', 'shortcuts'],
      apply(ctx) {
        diag('apply')
        try {
          const missing = []
          if (ctx.slots == null) missing.push('slots')
          if (ctx.layout == null) missing.push('layout')
          if (ctx.locale == null) missing.push('locale')
          for (const method of ['register', 'entries', 'subscribe', 'inject', 'spec']) {
            if (typeof ctx.slots?.[method] !== 'function') missing.push(`slots.${method}`)
          }
          if (missing.length > 0) {
            diag('guard-fail', missing)
            return
          }

          const panelPins = createPanelPins()
          let stockInject = null
          let injectCalls = 0

          const wrappedInject = function panelPinPersistInject(...args) {
            injectCalls += 1
            if (injectCalls <= 3) diag('inject', { call: injectCalls, stock: stockInject !== null })
            let face = {}
            if (stockInject !== null) {
              try {
                face = stockInject.apply(null, args) ?? {}
              } catch (error) {
                diag('stock-inject-threw', String(error && error.message ? error.message : error))
                face = {}
              }
            }
            const hooks = face.hooks === undefined ? {} : face.hooks
            return { ...face, setPinned: panelPins.setPinned, hooks: { ...hooks, entryPins: panelPins.unpinned } }
          }

          let shadow = null
          let patched = false
          const installShadow = () => {
            if (shadow !== null) return
            const entries = ctx.slots.entries(NS)
            const original = entries.find((entry) => typeof entry?.component === 'function')
            if (original === undefined) return
            if (!patched) {
              patched = true
              diag('entries', entries.map((entry) => ({
                keys: Object.keys(entry),
                hasEntryInject: typeof entry.inject,
                hasOptionsInject: typeof entry.options?.inject,
                priority: entry.options?.priority ?? null,
              })))
              const candidate = typeof original.inject === 'function'
                ? original.inject
                : (original.options && typeof original.options.inject === 'function' ? original.options.inject : null)
              stockInject = candidate
              // Patch the stock entry in place too: this also beats the
              // renderer's per-entry inject cache if the patch lands before
              // the first render.
              try {
                if (original.options && typeof original.options.inject === 'function') {
                  original.options.inject = wrappedInject
                }
              } catch (error) {
                diag('patch-options-threw', String(error && error.message ? error.message : error))
              }
              try {
                if (typeof original.inject === 'function') original.inject = wrappedInject
              } catch (error) {
                diag('patch-entry-threw', String(error && error.message ? error.message : error))
              }
              diag('patched', {
                stockFound: stockInject !== null,
                options: original.options?.inject === wrappedInject,
                entry: original.inject === wrappedInject,
              })
            }
            const standalone = ctx.slots.spec('sidebar.panellist') === undefined
            const Comp = original.component
            let renders = 0
            const ShadowSidebar = function PanelPinPersistSidebar(props) {
              renders += 1
              if (renders <= 3) diag('render', { n: renders })
              return Comp(props)
            }
            try {
              shadow = ctx.effect(() => ctx.slots.register({
                name: NS,
                locale: NS,
                inject: wrappedInject,
                priority: -1,
                ...(standalone ? { children: FALLBACK_CHILDREN } : {}),
              }, ShadowSidebar), 'panel-pin-persist: shadow sidebar')
              diag('registered', { standalone })
            } catch (error) {
              diag('register-threw', String(error && error.message ? error.message : error))
              shadow = null
            }
          }

          // Whichever happens last: our apply, the stock entry, or a later
          // re-registration of the stock entry.
          ctx.effect(() => ctx.slots.subscribe(NS, installShadow), 'panel-pin-persist: watch stock entry')
          ctx.slots.inject(NS, () => {
            installShadow()
            return () => {}
          })
          installShadow()
          if (shadow === null) diag('waiting', { entries: ctx.slots.entries(NS).length })

          globalThis.__panelPinPersist = {
            key: STORAGE_KEY,
            unpinned: () => [...panelPins.unpinned.getSnapshot()],
            diag: () => {
              try { return JSON.parse(localStorage.getItem(DIAG_KEY) || '[]') } catch { return [] }
            },
          }
        } catch (error) {
          diag('apply-threw', String(error && error.stack ? error.stack.slice(0, 400) : error))
        }
      },
    }
  },
})