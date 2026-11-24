// dsh-open-winc — browser half.
//
// One button in the session header utilities row:
//
//   [<Winc icon> Winc]
//
// Clicking it starts Winc on this conversation's live working directory. The
// page cannot start a process, so the host half (lib/index.js) does the launch;
// this half only decides which directory to name and shows the outcome. The icon
// is the editor's own, served by the host, with a built-in glyph as fallback.
//
// The directory is the `workingDirectory` projection, not the session header's
// `cwd`: a header cwd is fixed when the conversation is created, while the
// projection follows the agent into a worktree. The header cwd stays as the
// fallback for hosts that never record the projection.
//
// The button disappears when the host reports no Winc installation, so a
// machine without the editor sees no dead control.

;(function (root) {
  if (root === null || root === undefined) return
  if (typeof root.__ModuleLoader__ !== 'object' || root.__ModuleLoader__ === null) return

  root.__ModuleLoader__.load({
    id: 'dsh-open-winc',
    factory: (require) => {
      const module = { exports: {} }
      const exports = module.exports

      const React = require('react')
      const h = React.createElement
      const primitives = (() => {
        try {
          return require('@deepseek-ai/dsh-client-ui-primitives')
        } catch {
          return null
        }
      })()

      /** Host route reporting whether an editor is installed. */
      const STATUS_ROUTE = '/__dsh-open-winc/status'

      /** Host route that starts the editor. */
      const OPEN_ROUTE = '/__dsh-open-winc/open'

      /** Host route serving the editor's own icon. */
      const ICON_ROUTE = '/__dsh-open-winc/icon'

      /**
       * The same icon baked in, so the button still shows the application's mark
       * when the host route is not there yet (a freshly reloaded host serves the
       * route; an older one answers 404). A 32 px frame, downscaled to 14 px.
       */
      const EMBEDDED_ICON = 'data:image/png;base64,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'

      /** How long a one-line result stays beside the button. */
      const NOTICE_MS = 2400

      const zh = (() => {
        const lang = typeof navigator === 'object' && navigator !== null ? String(navigator.language || '') : ''
        return lang.toLowerCase().startsWith('zh')
      })()

      const TEXT = {
        label: 'Winc',
        open: (path) => (zh ? `在 Winc 中打开 ${path}` : `Open ${path} in Winc`),
        opened: zh ? '已打开' : 'Opened',
        missing: zh ? '未找到 Winc' : 'Winc not found',
        failed: zh ? '打开失败' : 'Could not open',
      }

      /** Chip styling; injected once, because a slot cannot ship a stylesheet. */
      const STYLE_ID = 'dsh-open-winc-style'
      const STYLE = [
        '.dsh-ow-group{display:inline-flex;align-items:center;gap:2px;min-width:0}',
        '.dsh-ow-btn{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 7px;border:0;',
        'border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1.5;',
        'opacity:.6;cursor:pointer}',
        '.dsh-ow-btn:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',
        '.dsh-ow-btn:disabled{opacity:.4;cursor:default}',
        // The editor ships its own icon; keep it square and clipped like the
        // header's other glyphs instead of letting the bitmap set the box.
        '.dsh-ow-icon{display:block;width:14px;height:14px;border-radius:3px;object-fit:contain}',
        '.dsh-ow-label{max-width:10ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dsh-ow-toast{padding:0 4px;font-size:11px;white-space:nowrap;',
        'color:var(--dsw-alias-label-secondary,#b6b8bb)}',
        '.dsh-ow-toast[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#e5534b)}',
      ].join('')

      /** Install the stylesheet, refreshing it after a hot reload. */
      function ensureStyle() {
        if (typeof document === 'undefined' || document === null) return
        const existing = document.getElementById(STYLE_ID)
        if (existing !== null && existing !== undefined) {
          if (existing.textContent !== STYLE) existing.textContent = STYLE
          return
        }
        const tag = document.createElement('style')
        tag.id = STYLE_ID
        tag.textContent = STYLE
        document.head.appendChild(tag)
      }

      /** A projection reads null or blank until the host records a value. */
      function usable(path) {
        return typeof path === 'string' && path.length > 0 ? path : undefined
      }

      /** GET a same-origin JSON route; undefined on any failure. */
      function get(route) {
        const url = new URL(route, document.baseURI).href
        return fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : undefined))
          .catch(() => undefined)
      }

      /** POST a same-origin JSON body; undefined on any failure. */
      function post(route, body) {
        const url = new URL(route, document.baseURI).href
        return fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          cache: 'no-store',
          body: JSON.stringify(body),
        })
          .then((response) => (response.ok ? response.json() : undefined))
          .catch(() => undefined)
      }

      /**
       * The header button.
       * @param props - the slot's standard props; `sessionId`, `useProjection`
       * and `useSessions` are the ones it reads.
       */
      function OpenWincAction(props) {
        const sessionId = props.sessionId
        // These readers are standard slot props. They are called as hooks, not
        // inside a memo: a memo hit would skip the hook call and change the hook
        // count between renders.
        const useProjection = typeof props.useProjection === 'function' ? props.useProjection : null
        const useSessions = typeof props.useSessions === 'function' ? props.useSessions : null

        const projected = useProjection === null ? undefined : useProjection('workingDirectory')
        const listed =
          useSessions === null
            ? undefined
            : useSessions((state) => {
                const byId = state === null || state === undefined ? undefined : state.byId
                const summary = byId === undefined || byId === null ? undefined : byId[sessionId]
                if (summary === undefined || summary === null) return undefined
                return summary.cwd || summary.workspacePath || undefined
              })
        const cwd = usable(projected) ?? usable(listed)

        const [available, setAvailable] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [notice, setNotice] = React.useState(null)
        // 0: the host serves the installed icon; 1: the baked-in copy of the same
        // frame; 2: a built-in glyph. A missing icon never leaves a broken image.
        const [iconStage, setIconStage] = React.useState(0)

        React.useEffect(() => {
          let live = true
          get(STATUS_ROUTE).then((body) => {
            if (!live) return
            setAvailable(body !== undefined && body.ok === true && body.available === true)
          })
          return () => {
            live = false
          }
        }, [])

        React.useEffect(() => {
          if (notice === null) return undefined
          const timer = setTimeout(() => setNotice(null), NOTICE_MS)
          return () => clearTimeout(timer)
        }, [notice])

        // No editor, no directory, or not answered yet: nothing to offer.
        if (available !== true || cwd === undefined) return null

        const run = () => {
          if (busy) return
          setBusy(true)
          setNotice(null)
          post(OPEN_ROUTE, { path: cwd }).then((body) => {
            setBusy(false)
            if (body !== undefined && body.ok === true) {
              setNotice({ tone: 'ok', text: TEXT.opened })
              return
            }
            const reason = body === undefined ? '' : String(body.reason || '')
            setNotice({ tone: 'error', text: reason === 'editor-missing' ? TEXT.missing : TEXT.failed })
          })
        }

        const children = []
        const glyph = primitives !== null && primitives.IconFolderOpenOutlineRegular !== undefined
          ? primitives.IconFolderOpenOutlineRegular
          : null
        const iconSource = iconStage === 0
          ? new URL(ICON_ROUTE, document.baseURI).href
          : EMBEDDED_ICON
        if (iconStage === 2) {
          if (glyph !== null) children.push(h(glyph, { key: 'icon', size: 13 }))
        } else {
          children.push(
            h('img', {
              key: 'icon',
              className: 'dsh-ow-icon',
              src: iconSource,
              width: 14,
              height: 14,
              alt: '',
              draggable: false,
              onError: () => setIconStage((stage) => (stage === 0 ? 1 : 2)),
            }),
          )
        }
        children.push(h('span', { key: 'label', className: 'dsh-ow-label' }, TEXT.label))

        return h('span', { className: 'dsh-ow-group' }, [
          h(
            'button',
            {
              key: 'button',
              type: 'button',
              className: 'dsh-ow-btn',
              disabled: busy,
              title: TEXT.open(cwd),
              'aria-label': TEXT.open(cwd),
              onClick: run,
            },
            children,
          ),
          notice === null
            ? null
            : h('span', { key: 'toast', className: 'dsh-ow-toast', 'data-tone': notice.tone }, notice.text),
        ])
      }

      /** Client plugin body: register the button in the session header. */
      function apply(ctx) {
        ensureStyle()
        if (!ctx.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return
        ctx.effect(() => {
          return ctx.slots.inject('conversation.session.header.utilities', () => {
            return ctx.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'open-winc',
                order: -10,
                label: () => TEXT.label,
              },
              OpenWincAction,
            )
          })
        }, 'dsh-open-winc: header button')
      }

      exports.inject = ['slots']
      exports.apply = apply
      return module.exports
    },
  })
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null)
