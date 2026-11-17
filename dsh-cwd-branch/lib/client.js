// dsh-cwd-branch — browser half.
//
// It contributes one entry to `conversation.input.left` — the list slot in the
// composer tool row, right after the permission chip (`+`, permission, plan,
// left, …). The entry is a two-segment pill:
//
//   [📁 order-module] [⑂ feat/order-module ● ▾]
//
// The left segment copies the absolute working directory; the right one opens
// a menu of every checkout of the same repository (the main checkout and each
// linked worktree) plus the local branches that no checkout holds, so the
// session can be moved without leaving the composer.
//
// The page cannot run git, so the host half (lib/index.js) answers both the
// status and the checkout list, and performs the switch itself.
;(function (root) {
  if (root === null || root === undefined) return
  if (typeof root.__ModuleLoader__ !== 'object' || root.__ModuleLoader__ === null) return

  root.__ModuleLoader__.load({
    id: 'dsh-cwd-branch',
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

      // The platform seeds react-dom, so the switch menu can be portalled into
      // document.body: a fixed layer inside the composer row is positioned
      // against whatever transformed ancestor happens to sit above it, which is
      // why the panel used to land away from the pill.
      const portal = (() => {
        try {
          const reactDom = require('react-dom')
          return typeof reactDom.createPortal === 'function' ? reactDom.createPortal : null
        } catch {
          return null
        }
      })()

      const ROUTE = '/__dsh-cwd-branch/status'
      const CHECKOUTS_ROUTE = '/__dsh-cwd-branch/checkouts'
      const SWITCH_ROUTE = '/__dsh-cwd-branch/switch'
      /** Host route that runs `git checkout <branch>` in the session's own checkout. */
const CHECKOUT_ROUTE = '/__dsh-cwd-branch/checkout'

      /** Re-ask this often; the host caches, so this is cheap. */
      const POLL_MS = 5000

      /** Longest directory string shown before it is shortened from the left. */
      const PATH_CHARS = 30

      /** How long the "copied" confirmation stays. */
      const COPIED_MS = 1200

      /** How long a switch notice stays under the menu. */
      const NOTICE_MS = 2600

      /** Width of the switch menu, in pixels. */
      const MENU_WIDTH = 320
      /** Tallest the switch menu may get before it scrolls. */
      const MENU_MAX_HEIGHT = 360

      /** The page locale decides the wording. */
      const zh = (() => {
        const lang = typeof navigator === 'object' && navigator !== null ? String(navigator.language || '') : ''
        return lang.toLowerCase().startsWith('zh')
      })()

      const COPY_HINT = zh ? '点击复制路径' : 'Click to copy the path'
      const COPIED_TEXT = zh ? '已复制' : 'Copied'
      const NO_REPO = zh ? '不是 git 仓库' : 'Not a git repository'
      const DETACHED = zh ? '游离 HEAD' : 'detached HEAD'
      const DIRTY = zh ? '有未提交的改动' : 'Uncommitted changes'
      const SWITCH_HINT = zh ? '点击查看分支、切换目录' : 'See branches and switch directory'
      const MENU_TITLE = zh ? '切换工作目录' : 'Switch working directory'
      const CHECKOUTS_TITLE = zh ? '检出（主仓库与工作树）' : 'Checkouts (main and worktrees)'
      const BRANCHES_TITLE = zh ? '其他分支（点击即切换）' : 'Other branches (click to switch)'
      const LOADING_TEXT = zh ? '读取中…' : 'Loading…'
      const EMPTY_TEXT = zh ? '没有可切换的目录' : 'Nothing to switch to'
      const CURRENT_TEXT = zh ? '当前' : 'current'
      const RUNNING_TEXT = zh ? '切换中…' : 'Switching…'
      const SWITCH_FAILED = zh ? '切换失败' : 'Switch failed'
      const CREATE_FAILED = zh ? '新建工作树失败' : 'Could not create the worktree'
      const SWITCHED_TEXT = zh ? '已切换' : 'Switched'
      const DEFERRED_TEXT = zh ? '会话开始后生效' : 'applies when the session starts'
      const CHECKED_OUT_TEXT = (name) => (zh ? `已切到 ${name}` : `Switched to ${name}`)
      const CHECKOUT_FAILED = zh ? '切换分支失败' : 'Could not switch branch'
      const MENU_NO_REPO = zh ? '当前目录不是 git 仓库，无法切换' : 'Not a git repository, nothing to switch'

      /** Chip styling; injected once, because a slot cannot ship a stylesheet. */
      const STYLE_ID = 'dsh-cwd-branch-style'
      const STYLE = [
        '.dsh-cb-group{display:inline-flex;align-items:center;height:24px;min-width:0;max-width:100%;margin-right:2px}',
        '.dsh-cb-seg{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 7px;border:0;',
        // line-height 1 clips the descenders of p/g/y against the fixed height, so
        // the label needs a line box taller than the glyphs.
        'background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1.5;opacity:.6;',
        'cursor:pointer;white-space:nowrap;transition:opacity .12s ease,background-color .12s ease}',
        '.dsh-cb-seg:hover{opacity:1;background:rgba(127,127,127,.14)}',
        '.dsh-cb-seg:focus-visible{opacity:1;outline:2px solid currentColor;outline-offset:-2px}',
        // The folder name is the primary identity, so it shrinks last: the branch
        // segment gives up its characters first (shrinks 6x faster) and the folder
        // keeps a readable minimum.
        '.dsh-cb-copy{border-radius:999px 0 0 999px;flex:1 1 auto;min-width:9ch;max-width:52ch;overflow:hidden}',
        '.dsh-cb-copy>.dsh-cb-path{overflow:hidden;text-overflow:ellipsis;min-width:0;padding:2px 0}',
        '.dsh-cb-branch{border-radius:0 999px 999px 0;border-left:1px solid rgba(127,127,127,.28);',
        'flex:0 6 auto;min-width:7ch;overflow:hidden}',
        '.dsh-cb-branch[data-open="true"]{opacity:1;background:rgba(127,127,127,.18)}',
        '.dsh-cb-branch>.dsh-cb-branchname{max-width:20ch;overflow:hidden;text-overflow:ellipsis;min-width:0;padding:2px 0}',
        // A 6px dot centred on the flex line reads high next to 12px text, whose
        // visual middle sits below the geometric one. A transform shifts it without
        // touching the layout, so the punctuation around it stays put.
        '.dsh-cb-dirty{width:6px;height:6px;border-radius:50%;background:#e0a33e;flex:none;',
        'align-self:center;transition:transform .12s ease;transform:translateY(2px)}',
        '.dsh-cb-caret{font-size:9px;opacity:.7;margin-left:-1px}',
        '.dsh-cb-group[data-empty="true"]{opacity:.35}',
        '.dsh-cb-menu{position:fixed;z-index:2147483000;box-sizing:border-box;padding:6px;',
        'border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-2,#24262a);',
        'color:var(--dsw-alias-label-primary,#e8e8e8);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));',
        'box-shadow:var(--dsw-shadow-lv2,0 12px 32px rgba(0,0,0,.4));font-size:12px;line-height:1.35;',
        'text-align:left;max-height:min(60vh,340px);overflow:auto;overscroll-behavior:contain}',
        '.dsh-cb-title{padding:5px 8px 4px;color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:11px}',
        '.dsh-cb-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;',
        'padding:6px 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;',
        'cursor:pointer;text-align:left}',
        '.dsh-cb-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',
        '.dsh-cb-item:disabled{opacity:.55;cursor:default}',
        '.dsh-cb-item[data-current="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.1))}',
        '.dsh-cb-item>.dsh-cb-itemname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dsh-cb-item[data-current="true"]>.dsh-cb-itemname{font-weight:600}',
        '.dsh-cb-item>.dsh-cb-itembranch{flex:none;max-width:18ch;overflow:hidden;text-overflow:ellipsis;',
        'white-space:nowrap;color:var(--dsw-alias-label-tertiary,#9aa0a6)}',
        '.dsh-cb-item>.dsh-cb-mark{flex:none;color:var(--dsw-alias-brand-primary,#4d6bfe)}',
        '.dsh-cb-confirm{margin:4px;padding:8px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.12))}',
        '.dsh-cb-confirm>p{margin:0 0 8px;overflow-wrap:anywhere}',
        '.dsh-cb-actions{display:flex;gap:6px;justify-content:flex-end}',
        '.dsh-cb-actions>button{font:inherit;font-size:12px;padding:3px 10px;border-radius:6px;',
        'border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:transparent;',
        'color:inherit;cursor:pointer}',
        '.dsh-cb-actions>button[data-primary="true"]{background:var(--dsw-alias-brand-primary,#4d6bfe);',
        'border-color:transparent;color:#fff}',
        '.dsh-cb-notice{padding:5px 8px 2px;color:var(--dsw-alias-label-tertiary,#9aa0a6)}',
        '.dsh-cb-notice[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#e5534b)}',
        // The result of a switch is reported beside the pill: the menu closes on
        // success, so a line inside it would never be read.
        '.dsh-cb-toast{flex:none;padding:0 4px;font-size:11px;white-space:nowrap;',
        'color:var(--dsw-alias-label-secondary,#b6b8bb)}',
        '.dsh-cb-toast[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#e5534b)}',
      ].join('')

      function ensureStyle() {
        if (typeof document === 'undefined' || document === null) return
        const existing = document.getElementById(STYLE_ID)
        if (existing !== null && existing !== undefined) {
          // A hot reload re-runs apply() against the same document: refresh the
          // rules instead of leaving the previous build's stylesheet in place.
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

      /** Last directory of a path, whichever separator the host used. */
      function lastSegment(path) {
        const parts = String(path).split(/[\\/]+/).filter((part) => part.length > 0)
        return parts.length === 0 ? String(path) : parts[parts.length - 1]
      }

      /** `cwd` below `root`, in forward slashes; null when it is not below it. */
      function relativeUnder(root, path) {
        // The host answers with forward slashes and the projection carries
        // Windows ones, so both sides are normalised before comparing.
        const base = String(root).replace(/\\/g, '/').replace(/\/+$/, '')
        const full = String(path).replace(/\\/g, '/')
        if (full.length <= base.length) return null
        if (full.slice(0, base.length).toLowerCase() !== base.toLowerCase()) return null
        if (full.charAt(base.length) !== '/') return null
        return full.slice(base.length).replace(/^\/+/, '') || null
      }

      /** Shorten a path from the left, keeping the tail that names the project. */
      function shorten(path) {
        if (path.length <= PATH_CHARS) return path
        return `…${path.slice(path.length - (PATH_CHARS - 1))}`
      }

      /** Copy text without assuming the async clipboard API is available. */
      function copy(text) {
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).catch(() => {})
            return
          }
        } catch {}
        try {
          const area = document.createElement('textarea')
          area.value = text
          area.setAttribute('readonly', '')
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.select()
          document.execCommand('copy')
          document.body.removeChild(area)
        } catch {}
      }

      /** True when two host replies describe the same repository state. */
      function sameReport(left, right) {
        if (left === right) return true
        if (left === null || right === null || left === undefined || right === undefined) return false
        return (
          left.cwd === right.cwd &&
          left.repoRoot === right.repoRoot &&
          left.branch === right.branch &&
          left.dirty === right.dirty &&
          left.detached === right.detached &&
          left.notRepo === right.notRepo &&
          left.isWorktree === right.isWorktree &&
          left.worktreeName === right.worktreeName &&
          left.mainRepo === right.mainRepo &&
          left.subPath === right.subPath
        )
      }

      /** One fetch of the host status route for `cwd`. */
      function askHost(cwd, signal) {
        const url = new URL(`${ROUTE}?cwd=${encodeURIComponent(cwd)}`, document.baseURI).href
        return fetch(url, { signal, headers: { accept: 'application/json' }, cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : undefined))
          .then((body) => (body !== undefined && body.ok === true ? body : undefined))
          .catch(() => undefined)
      }

      /** One fetch of the host checkout list for `cwd`. */
      function askCheckouts(cwd, signal) {
        const url = new URL(`${CHECKOUTS_ROUTE}?cwd=${encodeURIComponent(cwd)}`, document.baseURI).href
        return fetch(url, { signal, headers: { accept: 'application/json' }, cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : undefined))
          .catch(() => undefined)
      }

      /** One JSON POST to a host route. */
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
       * The composer-tool-row pill.
       * @param props - the slot's standard props; `sessionId`, `useProjection`,
       * `useSessions` and `useSession` are the ones it reads.
       */
      function CwdBranchChip(props) {
        const sessionId = props.sessionId
        // These readers are standard slot props. They are called as hooks, not
        // inside a memo: a memo hit would skip the hook call and change the
        // hook count between renders.
        const useProjection = typeof props.useProjection === 'function' ? props.useProjection : null
        const useSessions = typeof props.useSessions === 'function' ? props.useSessions : null
        const useSession = typeof props.useSession === 'function' ? props.useSession : null

        // The live directory. A conversation's header cwd is fixed when it is
        // created, so a session that later moved into a worktree still reports
        // the directory it started in; the workingDirectory projection is the
        // one that follows the agent.
        const projectedCwd = useProjection === null ? undefined : useProjection('workingDirectory')
        const listedCwd =
          useSessions === null
            ? undefined
            : useSessions((state) => {
                const byId = state === null || state === undefined ? undefined : state.byId
                const summary = byId === undefined || byId === null ? undefined : byId[sessionId]
                if (summary === undefined || summary === null) return undefined
                return summary.cwd || summary.workspacePath || undefined
              })
        const snapshotCwd =
          useSession === null ? undefined : useSession((snapshot) => (snapshot === null || snapshot === undefined ? undefined : snapshot.cwd))
        const cwd = usable(projectedCwd) || listedCwd || snapshotCwd || null

        const [report, setReport] = React.useState(null)
        const [copied, setCopied] = React.useState(false)
        const [tick, setTick] = React.useState(0)
        const [open, setOpen] = React.useState(false)
        const [checkouts, setCheckouts] = React.useState(null)
        const [loading, setLoading] = React.useState(false)
        const [busy, setBusy] = React.useState(null)
        const [notice, setNotice] = React.useState(null)
        const [anchor, setAnchor] = React.useState(null)
        const anchorRef = React.useRef(null)
        const menuRef = React.useRef(null)
        // Correction applied after measuring the panel against the pill: whatever
        // the composer row does to fixed positioning, the panel ends up flush with
        // the pill instead of wherever the last offset calculation guessed.
        const [shift, setShift] = React.useState({ left: 0, up: 0 })
        const shiftPasses = React.useRef(0)

        React.useEffect(() => {
          ensureStyle()
        }, [])

        React.useEffect(() => {
          if (!cwd) {
            setReport(null)
            return undefined
          }
          let live = true
          let controller = null
          const load = () => {
            try {
              if (controller !== null) controller.abort()
            } catch {}
            controller = typeof AbortController === 'function' ? new AbortController() : null
            askHost(cwd, controller === null ? undefined : controller.signal).then((body) => {
              if (!live) return
              const next = body === undefined ? null : body
              // A poll that changes nothing must not re-render the composer row.
              setReport((previous) => (sameReport(previous, next) ? previous : next))
            })
          }
          load()
          const timer = setInterval(load, POLL_MS)
          if (typeof window !== 'undefined' && window !== null) window.addEventListener('focus', load)
          return () => {
            live = false
            clearInterval(timer)
            if (typeof window !== 'undefined' && window !== null) window.removeEventListener('focus', load)
            try {
              if (controller !== null) controller.abort()
            } catch {}
          }
        }, [cwd, tick])

        React.useEffect(() => {
          if (copied === false) return undefined
          const timer = setTimeout(() => setCopied(false), COPIED_MS)
          return () => clearTimeout(timer)
        }, [copied])

        React.useEffect(() => {
          if (notice === null) return undefined
          const timer = setTimeout(() => setNotice(null), NOTICE_MS)
          return () => clearTimeout(timer)
        }, [notice])

        // Position the menu above the pill; a fixed layer is used because the
        // composer row clips its overflow.
        React.useEffect(() => {
          if (!open) {
            setAnchor(null)
            return undefined
          }
          shiftPasses.current = 0
          setShift({ left: 0, up: 0 })
          const place = () => {
            const node = anchorRef.current
            if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return
            const box = node.getBoundingClientRect()
            const wide = typeof window === 'undefined' || window === null
            const viewport = wide ? 1024 : window.innerWidth
            const height = wide ? 768 : window.innerHeight
            // Line the panel up with the pill instead of letting the viewport clamp
            // decide where it lands: its left edge follows the pill, and it hugs the
            // right edge only when it would otherwise run off the window.
            const right = box.left + MENU_WIDTH
            const left = right > viewport - 8 ? Math.max(8, box.right - MENU_WIDTH) : Math.max(8, box.left)
            const bottom = Math.max(8, height - box.top + 6)
            // Never grow past the space above the composer: a panel that is taller
            // than that would be cut off at the top of the window.
            const spaceAbove = box.top - 14
            const maxHeight = Math.max(180, Math.min(MENU_MAX_HEIGHT, spaceAbove))
            setAnchor({ left, bottom, maxHeight })
          }
          place()
          if (typeof window !== 'undefined' && window !== null) {
            window.addEventListener('resize', place)
            window.addEventListener('scroll', place, true)
          }
          return () => {
            if (typeof window !== 'undefined' && window !== null) {
              window.removeEventListener('resize', place)
              window.removeEventListener('scroll', place, true)
            }
          }
        }, [open])

        // Read the checkout list whenever the menu opens or the directory moves.
        React.useEffect(() => {
          if (!open || !cwd) {
            setCheckouts(null)
            return undefined
          }
          let live = true
          let controller = typeof AbortController === 'function' ? new AbortController() : null
          setLoading(true)
          askCheckouts(cwd, controller === null ? undefined : controller.signal).then((body) => {
            if (!live) return
            setLoading(false)
            setCheckouts(body === undefined ? { ok: false } : body)
          })
          return () => {
            live = false
            try {
              if (controller !== null) controller.abort()
            } catch {}
          }
        }, [open, cwd, tick])

        // Measure the rendered panel against the rendered pill and fold the
        // difference back into the offset. Two passes are plenty: the first fixes
        // a wrong containing block, the second absorbs the height change.
        React.useEffect(() => {
          if (!open) return undefined
          if (shiftPasses.current >= 3) return undefined
          const panel = menuRef.current
          const pill = anchorRef.current
          if (panel === null || panel === undefined || pill === null || pill === undefined) return undefined
          if (panel === pill) return undefined
          if (typeof panel.getBoundingClientRect !== 'function' || typeof pill.getBoundingClientRect !== 'function') return undefined
          const panelBox = panel.getBoundingClientRect()
          const pillBox = pill.getBoundingClientRect()
          const dx = panelBox.left - pillBox.left
          const dy = panelBox.bottom - (pillBox.top - 6)
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return undefined
          shiftPasses.current += 1
          setShift((previous) => ({ left: previous.left - dx, up: previous.up + dy }))
          return undefined
        })

        // Close on Escape or on a click outside the pill and its menu.
        React.useEffect(() => {
          if (!open) return undefined
          const onKey = (event) => {
            if (event.key === 'Escape') setOpen(false)
          }
          const onClick = (event) => {
            const node = anchorRef.current
            const target = event.target
            if (node !== null && node !== undefined && typeof node.contains === 'function' && node.contains(target)) return
            if (target !== null && target !== undefined && typeof target.closest === 'function' && target.closest('.dsh-cb-menu') !== null) return
            setOpen(false)
          }
          if (typeof document !== 'undefined' && document !== null) {
            document.addEventListener('keydown', onKey, true)
            document.addEventListener('mousedown', onClick, true)
          }
          return () => {
            if (typeof document !== 'undefined' && document !== null) {
              document.removeEventListener('keydown', onKey, true)
              document.removeEventListener('mousedown', onClick, true)
            }
          }
        }, [open])

        if (!cwd) return null

        const branch = report !== null && typeof report.branch === 'string' ? report.branch : null
        const dirty = report !== null && report.dirty === true
        const notRepo = report !== null && report.notRepo === true
        const detached = report !== null && report.detached === true
        const worktree =
          report !== null && report.isWorktree === true && typeof report.worktreeName === 'string' ? report.worktreeName : null
        const subPath = report !== null && typeof report.subPath === 'string' ? report.subPath : null
        const repoRoot = report !== null && typeof report.repoRoot === 'string' ? report.repoRoot : null
        const mainRepoRoot = report !== null && typeof report.mainRepoRoot === 'string' ? report.mainRepoRoot : null

        const notes = []
        if (worktree !== null) {
          notes.push(zh ? `git worktree，主仓库 ${mainRepoRoot}` : `git worktree of ${mainRepoRoot}`)
        }
        if (subPath !== null) notes.push(zh ? `位于 ${repoRoot}` : `inside ${repoRoot}`)
        if (notRepo) notes.push(NO_REPO)
        if (detached) notes.push(DETACHED)
        if (dirty) notes.push(DIRTY)
        notes.push(COPY_HINT)
        const copyTitle = `${cwd}${notes.length > 0 ? `\n${notes.join(' · ')}` : ''}`

        // The composer row is narrow, so the pill names the folder being worked
        // in and nothing more: `order-module`, or `order-module/src` when the
        // session sits in a subdirectory. The repository behind a worktree, and
        // the full path, live in the tooltip — squeezing them onto the row is
        // what made every part unreadable.
        const head = worktree !== null ? worktree : repoRoot !== null ? lastSegment(repoRoot) : lastSegment(cwd)
        const inner = repoRoot === null ? null : relativeUnder(repoRoot, cwd)
        const label = inner === null || inner === '' ? head : `${head}/${inner}`

        const folderIcon =
          worktree !== null
            ? primitives !== null && primitives.IconFolderOpenRegular !== undefined
              ? primitives.IconFolderOpenRegular
              : null
            : primitives !== null && primitives.IconFolderCloseRegular !== undefined
              ? primitives.IconFolderCloseRegular
              : null
        const branchIcon =
          primitives !== null && primitives.IconBranchOutlineRegular !== undefined ? primitives.IconBranchOutlineRegular : null

        const copyChildren = []
        if (folderIcon !== null) copyChildren.push(h(folderIcon, { key: 'folder', size: 13 }))
        copyChildren.push(
          h('span', { key: 'path', className: 'dsh-cb-path' }, copied ? COPIED_TEXT : shorten(label)),
        )

        const branchChildren = []
        if (branchIcon !== null) branchChildren.push(h(branchIcon, { key: 'icon', size: 12 }))
        branchChildren.push(
          h('span', { key: 'name', className: 'dsh-cb-branchname' }, branch === null ? (zh ? '无分支' : 'no branch') : branch),
        )
        if (dirty) branchChildren.push(h('span', { key: 'dirty', className: 'dsh-cb-dirty', title: DIRTY }))
        branchChildren.push(h('span', { key: 'caret', className: 'dsh-cb-caret' }, '▾'))

        const switchTo = (path) => {
          setBusy(path)
          post(SWITCH_ROUTE, { sessionId, path }).then((body) => {
            setBusy(null)
            if (body === undefined || body.ok !== true) {
              const reason = body === undefined ? '' : String(body.reason || '')
              setNotice({ tone: 'error', text: `${SWITCH_FAILED}${reason === '' ? '' : ` (${reason})`}` })
              return
            }
            setOpen(false)
            setNotice({ tone: 'ok', text: body.deferred === true ? DEFERRED_TEXT : SWITCHED_TEXT })
            setTick((value) => value + 1)
          })
        }

        /** Ask the host to run `git checkout` in this session's own directory. */
        const checkoutBranch = (name) => {
          setBusy(name)
          post(CHECKOUT_ROUTE, { sessionId, cwd, branch: name }).then((body) => {
            setBusy(null)
            if (body === undefined || body.ok !== true) {
              const detail = body === undefined ? '' : String(body.message || body.reason || '')
              setNotice({ tone: 'error', text: `${CHECKOUT_FAILED}${detail === '' ? '' : `：${detail}`}` })
              return
            }
            setOpen(false)
            setNotice({ tone: 'ok', text: CHECKED_OUT_TEXT(name) })
            setTick((value) => value + 1)
          })
        }

        const menu = []
        if (open) {
          if (anchor !== null) {
            menu.push(
              h('div', { key: 'header', className: 'dsh-cb-title' }, MENU_TITLE),
            )
            if (loading) {
              menu.push(h('div', { key: 'loading', className: 'dsh-cb-notice' }, LOADING_TEXT))
            } else if (notRepo) {
              menu.push(h('div', { key: 'norepo', className: 'dsh-cb-notice' }, MENU_NO_REPO))
            } else if (checkouts === null || checkouts.ok !== true) {
              menu.push(h('div', { key: 'failed', className: 'dsh-cb-notice', 'data-tone': 'error' }, SWITCH_FAILED))
            } else {
              const rows = Array.isArray(checkouts.checkouts) ? checkouts.checkouts : []
              if (rows.length > 0) {
                menu.push(h('div', { key: 'ct', className: 'dsh-cb-title' }, CHECKOUTS_TITLE))
                rows.forEach((row, index) => {
                  const current = row.current === true
                  const switching = busy !== null && busy === row.path
                  const itemChildren = [
                    h('span', { key: 'name', className: 'dsh-cb-itemname' }, row.name === '' ? row.path : row.name),
                    h('span', { key: 'branch', className: 'dsh-cb-itembranch' }, row.branch === null ? (row.detached ? DETACHED : '') : row.branch),
                  ]
                  if (switching) itemChildren.push(h('span', { key: 'busy', className: 'dsh-cb-mark' }, RUNNING_TEXT))
                  else if (current) itemChildren.push(h('span', { key: 'mark', className: 'dsh-cb-mark' }, '✓'))
                  menu.push(
                    h(
                      'button',
                      {
                        key: `co${index}`,
                        type: 'button',
                        className: 'dsh-cb-item',
                        'data-current': current ? 'true' : undefined,
                        disabled: current || (busy !== null && !switching),
                        title: row.path,
                        onClick: () => switchTo(row.path),
                      },
                      itemChildren,
                    ),
                  )
                })
              } else {
                menu.push(h('div', { key: 'empty', className: 'dsh-cb-notice' }, EMPTY_TEXT))
              }

              const free = Array.isArray(checkouts.branches) ? checkouts.branches : []
              if (free.length > 0) {
                menu.push(h('div', { key: 'bt', className: 'dsh-cb-title' }, BRANCHES_TITLE))
                // A click is the switch: no confirm step, no second button. None of
                // these branches has a checkout of its own, so `git checkout` runs
                // where the session already sits, and git's own refusal (dirty tree,
                // or the branch already used by another worktree) is shown as-is.
                free.forEach((row, index) => {
                  const switching = busy !== null && busy === row.name
                  menu.push(
                    h(
                      'button',
                      {
                        key: `br${index}`,
                        type: 'button',
                        className: 'dsh-cb-item',
                        disabled: busy !== null,
                        title: zh
                          ? `在当前目录执行 git checkout ${row.name}`
                          : `Run git checkout ${row.name} here`,
                        onClick: () => checkoutBranch(row.name),
                      },
                      [
                        h('span', { key: 'name', className: 'dsh-cb-itemname' }, row.name),
                        h('span', { key: 'mark', className: 'dsh-cb-mark' }, switching ? RUNNING_TEXT : ''),
                      ],
                    ),
                  )
                })
              }
            }

            if (notice !== null && open) {
              menu.push(
                h('div', { key: 'notice', className: 'dsh-cb-notice', 'data-tone': notice.tone }, notice.text),
              )
            }
          }
        }

        const popover =
          open && anchor !== null
            ? h(
                'div',
                {
                  className: 'dsh-cb-menu',
                  ref: menuRef,
                  style: {
                    left: `${anchor.left + shift.left}px`,
                    bottom: `${anchor.bottom + shift.up}px`,
                    width: `${MENU_WIDTH}px`,
                    maxHeight: `${anchor.maxHeight === undefined ? MENU_MAX_HEIGHT : anchor.maxHeight}px`,
                  },
                  onMouseDown: (event) => event.stopPropagation(),
                },
                menu,
              )
            : null

        const floating =
          popover !== null && portal !== null && typeof document !== 'undefined' && document.body !== null
            ? portal(popover, document.body)
            : popover

        return h('span', { className: 'dsh-cb-group', ref: anchorRef, 'data-empty': branch === null && !notRepo ? 'true' : undefined }, [
          h(
            'button',
            {
              key: 'copy',
              type: 'button',
              className: 'dsh-cb-seg dsh-cb-copy',
              title: copyTitle,
              'aria-label': `${cwd}`,
              onClick: () => {
                copy(cwd)
                setCopied(true)
              },
            },
            copyChildren,
          ),
          h(
            'button',
            {
              key: 'branch',
              type: 'button',
              className: 'dsh-cb-seg dsh-cb-branch',
              'data-open': open ? 'true' : undefined,
              title: `${branch === null ? (zh ? '无分支' : 'no branch') : branch}${notRepo ? ` · ${NO_REPO}` : ''}\n${SWITCH_HINT}`,
              'aria-haspopup': 'menu',
              'aria-expanded': open ? 'true' : 'false',
              onClick: () => {
                setOpen((value) => !value)
                setNotice(null)
              },
            },
            branchChildren,
          ),
          floating,
          notice !== null && !open
            ? h('span', { key: 'toast', className: 'dsh-cb-toast', 'data-tone': notice.tone }, notice.text)
            : null,
        ])
      }

      /** Client plugin body: register the pill into the composer tool row. */
      function apply(ctx) {
        ensureStyle()
        if (!ctx.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return
        ctx.effect(() => {
          return ctx.slots.inject('conversation.input.left', () => {
            return ctx.slots.register(
              {
                name: 'conversation.input.left',
                id: 'dsh-cwd-branch',
                order: 100,
                label: () => (zh ? '工作目录与分支' : 'Working directory and branch'),
              },
              CwdBranchChip,
            )
          })
        }, 'dsh-cwd-branch: composer chip')
      }

      exports.inject = ['slots']
      exports.apply = apply
      return module.exports
    },
  })
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null)
