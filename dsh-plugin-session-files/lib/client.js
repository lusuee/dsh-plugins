/**
 * Browser half of `dsh-plugin-session-files`.
 *
 * A `conversation.view` tab that lists every file this Session produced: the
 * entries come from the Host's `sessionFiles` projection, so the list is the
 * same after a reload, on a second tab, and after a reconnect. The view only
 * filters, groups, and opens what the Host already computed.
 *
 * Deliberate packaging choices:
 *
 * - hand-written `__ModuleLoader__` bundle like the other local plugins, with
 *   `react` taken from the host's module table: importing Harness client
 *   packages would tie this plugin to their internal module graph and break on
 *   a DSH upgrade;
 * - the sidebar service is looked up lazily on click instead of being declared
 *   as an injection: a missing preview surface must degrade to a toast, not
 *   prevent the whole tab from loading;
 * - styling uses only `--dsw-alias-*` theme tokens with fallbacks, scoped to
 *   its own `data-session-files-*` attributes so no host class names leak in.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-session-files',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement

    var NS = 'session-files'
    var SLOT_ID = 'session-files'
    var VIEW_ORDER = 20

    var FONT_STACK =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'
    var MONO_STACK =
      '"SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, "Liberation Mono", monospace'

    var ZH = {
      'view.label': '文件',
      'header.title': '会话文件',
      'header.subtitle': '本会话由写入、编辑或交付产生的文件。',
      'header.search': '搜索文件名或路径',
      'header.copyAll': '复制全部路径',
      'header.copied': '已复制 {count} 个路径',
      'filter.all': '全部',
      'filter.created': '新建',
      'filter.edited': '修改',
      'filter.presented': '交付',
      'row.created': '新建',
      'row.edited': '修改',
      'row.presented': '交付',
      'row.turn': '第 {turn} 轮',
      'row.root': '工作区根目录',
      'row.open': '打开',
      'row.copy': '复制路径',
      'count.files': '{count} 个文件',
      'empty.title': '本会话还没有产生文件',
      'empty.body': 'Agent 写入、编辑或交付文件后，会出现在这里。',
      'empty.hint': '终端命令直接创建、且未交付的文件不会列出。',
      'empty.search': '没有匹配的文件',
      'empty.clear': '清除筛选',
      'notice.openFailed': '无法打开预览：右侧栏不可用。',
      'notice.copyFailed': '复制失败，请检查剪贴板权限。',
    }

    var EN = {
      'view.label': 'Files',
      'header.title': 'Session files',
      'header.subtitle': 'Files this session wrote, edited, or delivered.',
      'header.search': 'Search names or paths',
      'header.copyAll': 'Copy all paths',
      'header.copied': 'Copied {count} paths',
      'filter.all': 'All',
      'filter.created': 'New',
      'filter.edited': 'Edited',
      'filter.presented': 'Delivered',
      'row.created': 'new',
      'row.edited': 'edited',
      'row.presented': 'delivered',
      'row.turn': 'turn {turn}',
      'row.root': 'workspace root',
      'row.open': 'Open',
      'row.copy': 'Copy path',
      'count.files': '{count} files',
      'empty.title': 'No files yet',
      'empty.body': 'Files appear here once the agent writes, edits, or delivers them.',
      'empty.hint': 'Files created by shell commands stay hidden unless delivered.',
      'empty.search': 'No matching files',
      'empty.clear': 'Clear filters',
      'notice.openFailed': 'Could not open the preview: the sidebar is unavailable.',
      'notice.copyFailed': 'Copy failed. Check clipboard permission.',
    }

    /** Theme token values, each with a light/dark-safe fallback. */
    var TOKEN = {
      labelPrimary: 'var(--dsw-alias-label-primary, #1b1b1c)',
      labelSecondary: 'var(--dsw-alias-label-secondary, #4a4a4f)',
      labelTertiary: 'var(--dsw-alias-label-tertiary, #7c7c82)',
      labelCaption: 'var(--dsw-alias-label-caption, #9a9aa0)',
      bgLayer1: 'var(--dsw-alias-bg-layer-1, #ffffff)',
      bgLayer2: 'var(--dsw-alias-bg-layer-2, #f4f4f5)',
      bgBase: 'var(--dsw-alias-bg-base, #ffffff)',
      borderL2: 'var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.10))',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(120, 120, 128, 0.10))',
      pressed: 'var(--dsw-alias-interactive-bg-pressed, rgba(120, 120, 128, 0.16))',
      business: 'var(--dsw-alias-state-business-primary, #3b82f6)',
      success: 'var(--dsw-alias-state-success-primary, #22a06b)',
      warn: 'var(--dsw-alias-state-warn-primary, #c27c0e)',
      danger: 'var(--dsw-alias-state-danger-primary, #d92d20)',
    }

    /* ------------------------------------------------------------------ */
    /* Pure helpers (also exposed for the offline harness)                */
    /* ------------------------------------------------------------------ */

    /** @param value - anything. @returns the string, or '' for non-strings. */
    function textOf(value) {
      return typeof value === 'string' ? value : ''
    }

    /** @param path - any path. @returns it with `/` separators. */
    function normalizePath(path) {
      return textOf(path).replace(/\\/g, '/')
    }

    /**
     * Drop leading `./` segments so display and address agree.
     * @param path - normalized path.
     * @returns the path without a relative prefix.
     */
    function trimRelative(path) {
      return path.replace(/^(?:\.\/)+/, '')
    }

    /**
     * Split a path into its directory and final segment.
     * @param path - any path.
     * @returns `{ dir, name }`; dir is '' for a bare name.
     */
    function splitPath(path) {
      var normalized = normalizePath(path)
      var slash = normalized.lastIndexOf('/')
      if (slash === -1) return { dir: '', name: normalized }
      return { dir: normalized.slice(0, slash), name: normalized.slice(slash + 1) }
    }

    /**
     * Whether a workspace comparison is case-insensitive.
     * @param cwd - the Session working directory.
     * @returns whether the workspace looks like a Windows/UNC path.
     */
    function foldsCase(cwd) {
      return /^[A-Za-z]:\//.test(cwd) || cwd.slice(0, 2) === '//'
    }

    /**
     * Express an absolute path relative to the Session working directory when
     * it lives inside it; otherwise keep it absolute.
     * @param path - the file path.
     * @param cwd - the Session working directory.
     * @returns the display path, '' when the path is the directory itself.
     */
    function relativeTo(path, cwd) {
      var target = normalizePath(path)
      var root = normalizePath(cwd).replace(/\/+$/, '')
      if (root === '') return target
      var insensitive = foldsCase(root)
      if (insensitive ? target.toLowerCase() === root.toLowerCase() : target === root) return ''
      var prefix = root + '/'
      var inside = insensitive ? target.toLowerCase().slice(0, prefix.length) === prefix.toLowerCase() : target.slice(0, prefix.length) === prefix
      return inside ? target.slice(prefix.length) : target
    }

    /**
     * The extension shown on a file chip.
     * @param name - the file name.
     * @returns a lowercase extension, or '' when there is none worth showing.
     */
    function extensionOf(name) {
      var dot = name.lastIndexOf('.')
      if (dot <= 0 || dot === name.length - 1) return ''
      var extension = name.slice(dot + 1).toLowerCase()
      return extension.length <= 8 ? extension : ''
    }

    /** Code extensions, shown in the business color. */
    var CODE_EXTENSIONS = new Set([
      'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h',
      'cpp', 'hpp', 'cc', 'cs', 'rb', 'php', 'swift', 'sh', 'bash', 'zsh', 'ps1', 'lua', 'vue',
      'svelte', 'html', 'css', 'scss', 'less', 'sql',
    ])

    /** Documentation extensions, shown in the success color. */
    var DOC_EXTENSIONS = new Set(['md', 'mdx', 'txt', 'rst', 'adoc', 'org', 'pdf'])

    /** Image extensions, shown in the warning color. */
    var IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'])

    /** Data extensions, shown in the secondary label color. */
    var DATA_EXTENSIONS = new Set(['json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'csv', 'tsv', 'xlsx', 'xls', 'parquet', 'sqlite', 'db', 'ipynb'])

    /**
     * The accent token for a file chip.
     * @param extension - a lowercase extension, possibly ''.
     * @returns a CSS color value.
     */
    function accentOf(extension) {
      if (CODE_EXTENSIONS.has(extension)) return TOKEN.business
      if (DOC_EXTENSIONS.has(extension)) return TOKEN.success
      if (IMAGE_EXTENSIONS.has(extension)) return TOKEN.warn
      if (DATA_EXTENSIONS.has(extension)) return TOKEN.labelSecondary
      return TOKEN.labelTertiary
    }

    /**
     * Fill `{name}` placeholders in a localized string. Implemented here so the
     * view does not depend on the locale service's interpolation syntax.
     * @param t - the bound translator.
     * @param key - locale key.
     * @param params - placeholder values.
     * @returns the interpolated text.
     */
    function format(t, key, params) {
      var template = typeof t === 'function' ? t(key) : key
      if (typeof template !== 'string') return key
      return template.replace(/\{(\w+)\}/g, function (match, name) {
        return params && params[name] !== undefined ? String(params[name]) : match
      })
    }

    /**
     * Compose the address the sidebar's document preview understands for a
     * Session file. Mirrors `sessionFileAddress` from
     * `@deepseek-ai/dsh-util-workspace-path`; the plugin keeps its own copy so
     * the bundle never imports a Harness client package.
     * @param sessionId - the Session id.
     * @param path - the file path.
     * @returns the `dsh-resource://file/...` address.
     */
    function sessionFileAddress(sessionId, path) {
      function encodeSegment(segment) {
        return encodeURIComponent(segment).replace(/%3A/gi, ':')
      }
      var normalized = trimRelative(normalizePath(path))
      var encodedPath = normalized.split('/').map(encodeSegment).join('/')
      return 'dsh-resource://file/session/' + encodeSegment(sessionId) + '/' + encodedPath
    }

    /**
     * Filter and order the entries for display.
     * @param files - the projection's entries.
     * @param filter - 'all' | 'created' | 'edited' | 'presented'.
     * @param query - free-text search over path, name, and description.
     * @returns a new array, most recently touched first.
     */
    function filterFiles(files, filter, query) {
      var needle = textOf(query).trim().toLowerCase()
      var source = Array.isArray(files) ? files : []
      var out = []
      for (var i = 0; i < source.length; i += 1) {
        var entry = source[i]
        if (!entry || typeof entry.path !== 'string' || entry.path === '') continue
        if (filter === 'created' && !entry.created) continue
        if (filter === 'edited' && !entry.edited) continue
        if (filter === 'presented' && !entry.presented) continue
        if (needle !== '') {
          var haystack = entry.path + ' ' + textOf(entry.description)
          if (haystack.toLowerCase().indexOf(needle) === -1) continue
        }
        out.push(entry)
      }
      out.sort(function (left, right) {
        var a = typeof left.seq === 'number' ? left.seq : 0
        var b = typeof right.seq === 'number' ? right.seq : 0
        return b - a
      })
      return out
    }

    /**
     * Count how many entries each filter would show.
     * @param files - the projection's entries.
     * @returns `{ all, created, edited, presented }`.
     */
    function countByFilter(files) {
      var source = Array.isArray(files) ? files : []
      var counts = { all: 0, created: 0, edited: 0, presented: 0 }
      for (var i = 0; i < source.length; i += 1) {
        var entry = source[i]
        if (!entry || typeof entry.path !== 'string' || entry.path === '') continue
        counts.all += 1
        if (entry.created) counts.created += 1
        if (entry.edited) counts.edited += 1
        if (entry.presented) counts.presented += 1
      }
      return counts
    }

    /**
     * Copy text, preferring the async clipboard and falling back to a hidden
     * textarea for contexts where the clipboard API is denied.
     * @param text - the text to copy.
     * @returns whether the copy call was accepted.
     */
    function copyText(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(text).catch(function () {
            /* the fallback path only runs when the API is absent */
          })
          return true
        }
      } catch (error) {
        /* fall through to the legacy path */
      }
      try {
        var area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.left = '-9999px'
        area.style.top = '0'
        document.body.appendChild(area)
        area.select()
        var copied = document.execCommand('copy')
        document.body.removeChild(area)
        return copied === true
      } catch (error) {
        return false
      }
    }

    /* ------------------------------------------------------------------ */
    /* Icons                                                              */
    /* ------------------------------------------------------------------ */

    function svgIcon(size, children) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        children,
      )
    }

    function fileGlyph(size) {
      return svgIcon(size, [
        h('path', { key: 'body', d: 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z' }),
        h('path', { key: 'fold', d: 'M13 3v6h6' }),
      ])
    }

    function searchGlyph(size) {
      return svgIcon(size, [
        h('circle', { key: 'lens', cx: 11, cy: 11, r: 7 }),
        h('path', { key: 'handle', d: 'M16.5 16.5 21 21' }),
      ])
    }

    function copyGlyph(size) {
      return svgIcon(size, [
        h('rect', { key: 'front', x: 9, y: 9, width: 11, height: 11, rx: 2 }),
        h('path', { key: 'back', d: 'M5 15V5a2 2 0 0 1 2-2h10' }),
      ])
    }

    function chevronGlyph(size) {
      return svgIcon(size, [h('path', { key: 'chevron', d: 'M9 6l6 6-6 6' })])
    }

    /* ------------------------------------------------------------------ */
    /* Styles                                                             */
    /* ------------------------------------------------------------------ */

    var CSS_TEXT = [
      '[data-session-files-view] *{box-sizing:border-box}',
      '[data-session-files-view] input{font-family:inherit}',
      '[data-session-files-search]{transition:border-color .12s ease, background-color .12s ease}',
      '[data-session-files-search]::placeholder{color:' + TOKEN.labelCaption + '}',
      '[data-session-files-search]:focus{outline:none;border-color:' + TOKEN.business + ';background:' + TOKEN.bgBase + '}',
      '[data-session-files-search]:focus-visible{outline:2px solid ' + TOKEN.business + ';outline-offset:1px}',
      '[data-session-files-button]{transition:background-color .12s ease, border-color .12s ease, color .12s ease}',
      '[data-session-files-button]:hover:not(:disabled){background:' + TOKEN.hover + ';color:' + TOKEN.labelPrimary + '}',
      '[data-session-files-button]:focus-visible{outline:2px solid ' + TOKEN.business + ';outline-offset:1px}',
      '[data-session-files-chip]{transition:background-color .12s ease, color .12s ease}',
      '[data-session-files-chip]:hover{background:' + TOKEN.hover + '}',
      '[data-session-files-chip]:focus-visible{outline:2px solid ' + TOKEN.business + ';outline-offset:1px}',
      '[data-session-files-row]{transition:background-color .12s ease}',
      '[data-session-files-row]:hover{background:' + TOKEN.hover + '}',
      '[data-session-files-row]:active{background:' + TOKEN.pressed + '}',
      '[data-session-files-row]:focus-visible{outline:2px solid ' + TOKEN.business + ';outline-offset:-2px}',
      '[data-session-files-action]{opacity:0;transition:opacity .12s ease, background-color .12s ease}',
      '[data-session-files-row]:hover [data-session-files-action],' +
        '[data-session-files-row]:focus-within [data-session-files-action]{opacity:1}',
      '[data-session-files-action]:hover{background:' + TOKEN.pressed + '}',
      '[data-session-files-action]:focus-visible{opacity:1;outline:2px solid ' + TOKEN.business + ';outline-offset:-2px}',
      '[data-session-files-scroll]{scrollbar-width:thin;scrollbar-color:transparent transparent}',
      '[data-session-files-scroll]:hover{scrollbar-color:' + TOKEN.borderL2 + ' transparent}',
      '[data-session-files-scroll]::-webkit-scrollbar{width:10px;height:10px}',
      '[data-session-files-scroll]::-webkit-scrollbar-track{background:transparent}',
      '[data-session-files-scroll]::-webkit-scrollbar-thumb{background:' + TOKEN.borderL2 + ';border-radius:999px;border:3px solid transparent;background-clip:content-box}',
      '[data-session-files-scroll]::-webkit-scrollbar-thumb:hover{background:' + TOKEN.labelCaption + ';border:3px solid transparent;background-clip:content-box}',
    ].join('')

    /* ------------------------------------------------------------------ */
    /* View                                                               */
    /* ------------------------------------------------------------------ */

    var ROOT_STYLE = {
      position: 'relative',
      isolation: 'isolate',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      height: '100%',
      minHeight: 0,
      width: '100%',
      boxSizing: 'border-box',
      color: TOKEN.labelPrimary,
      background: TOKEN.bgLayer1,
      fontFamily: FONT_STACK,
    }

    var HEADER_STYLE = {
      flex: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: '14px 20px 10px',
      borderBottom: '1px solid ' + TOKEN.borderL2,
    }

    var LIST_STYLE = {
      flex: '1 1 auto',
      minHeight: 0,
      overflowY: 'auto',
      overflowX: 'hidden',
      padding: '6px 10px',
      // The conversation composer floats over this view (the view marks itself
      // with data-conversation-composer-overlay), and ConversationRoot publishes
      // its live height. Reserve that height inside the scroller so the last
      // rows can scroll clear of the composer instead of hiding behind it.
      paddingBottom: 'calc(var(--dsh-composer-height, 152px) + 16px)',
      display: 'flex',
      flexDirection: 'column',
      gap: 1,
    }

    function headerButtonStyle(disabled) {
      return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 30,
        padding: '0 10px',
        borderRadius: 8,
        border: '1px solid ' + TOKEN.borderL2,
        background: 'transparent',
        color: disabled ? TOKEN.labelCaption : TOKEN.labelSecondary,
        fontSize: 12,
        lineHeight: '18px',
        fontFamily: FONT_STACK,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        flex: 'none',
        whiteSpace: 'nowrap',
      }
    }

    function searchStyle() {
      return {
        height: 30,
        width: 220,
        maxWidth: '100%',
        padding: '0 10px 0 30px',
        borderRadius: 8,
        border: '1px solid ' + TOKEN.borderL2,
        background: TOKEN.bgLayer2,
        color: TOKEN.labelPrimary,
        fontSize: 12.5,
        lineHeight: '18px',
        fontFamily: FONT_STACK,
      }
    }

    function chipStyle(active) {
      return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 24,
        padding: '0 10px',
        borderRadius: 999,
        border: '1px solid transparent',
        background: active ? TOKEN.bgLayer2 : 'transparent',
        color: active ? TOKEN.labelPrimary : TOKEN.labelTertiary,
        fontSize: 12,
        lineHeight: '16px',
        fontFamily: FONT_STACK,
        cursor: 'pointer',
        flex: 'none',
      }
    }

    function badgeStyle(kind) {
      var color = kind === 'created' ? TOKEN.business : kind === 'edited' ? TOKEN.warn : TOKEN.success
      return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10.5,
        lineHeight: '14px',
        color: TOKEN.labelTertiary,
        whiteSpace: 'nowrap',
        flex: 'none',
      }
    }

    /**
     * One badge: a colored dot plus its label, so state never relies on color alone.
     * @param key - badge key, used for React reconciliation.
     * @param label - visible label.
     * @param kind - 'created' | 'edited' | 'presented'.
     * @returns the badge element.
     */
    function renderBadge(key, label, kind) {
      var dotColor = kind === 'created' ? TOKEN.business : kind === 'edited' ? TOKEN.warn : TOKEN.success
      return h(
        'span',
        { key: key, style: badgeStyle(kind) },
        h('span', {
          'aria-hidden': true,
          style: { width: 5, height: 5, borderRadius: '50%', background: dotColor, flex: 'none' },
        }),
        label,
      )
    }

    /**
     * One row: extension chip, name and state badges, directory and turn, actions.
     * @param props - `{ entry, cwd, t, openFile, onCopy, onOpen }`.
     * @returns the row element.
     */
    function FileRow(props) {
      var entry = props.entry
      var t = props.t
      var shown = relativeTo(entry.path, props.cwd)
      var target = shown === '' ? normalizePath(entry.path) : shown
      var parts = splitPath(target)
      var name = parts.name === '' ? target : parts.name
      var directory = parts.dir === '' ? t('row.root') : parts.dir
      var extension = extensionOf(name)
      var chipLabel = extension === '' ? 'FILE' : extension.toUpperCase()

      var badges = []
      if (entry.created) badges.push(renderBadge('created', t('row.created'), 'created'))
      if (entry.edited) badges.push(renderBadge('edited', t('row.edited'), 'edited'))
      if (entry.presented) badges.push(renderBadge('presented', t('row.presented'), 'presented'))

      function activate() {
        props.onOpen(entry)
      }

      return h(
        'div',
        {
          'data-session-files-row': '',
          role: 'button',
          tabIndex: 0,
          title: entry.path,
          'aria-label': t('row.open') + ': ' + name,
          onClick: activate,
          onKeyDown: function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              activate()
            }
          },
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 10px',
            borderRadius: 9,
            cursor: 'pointer',
            minWidth: 0,
          },
        },
        h(
          'span',
          {
            'aria-hidden': true,
            style: {
              width: 36,
              height: 36,
              flex: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 9,
              background: TOKEN.bgLayer2,
              color: accentOf(extension),
              fontFamily: MONO_STACK,
              fontSize: extension === '' ? 8.5 : 9.5,
              fontWeight: 600,
              letterSpacing: '0.4px',
              textTransform: 'uppercase',
            },
          },
          chipLabel,
        ),
        h(
          'span',
          {
            style: {
              flex: '1 1 auto',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            },
          },
          h(
            'span',
            { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            h(
              'span',
              {
                style: {
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: '18px',
                  color: TOKEN.labelPrimary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              },
              name,
            ),
            badges.length > 0 ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } }, badges) : null,
          ),
          h(
            'span',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                minWidth: 0,
                fontSize: 11.5,
                lineHeight: '16px',
                color: TOKEN.labelTertiary,
              },
            },
            h(
              'span',
              { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } },
              directory,
            ),
            h('span', { 'aria-hidden': true, style: { flex: 'none', color: TOKEN.labelCaption } }, '·'),
            h(
              'span',
              { style: { flex: 'none', fontVariantNumeric: 'tabular-nums' } },
              format(t, 'row.turn', { turn: typeof entry.lastTurn === 'number' ? entry.lastTurn : 1 }),
            ),
          ),
          textOf(entry.description) !== ''
            ? h(
                'span',
                {
                  style: {
                    fontSize: 11.5,
                    lineHeight: '16px',
                    color: TOKEN.labelCaption,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                entry.description,
              )
            : null,
        ),
        h(
          'button',
          {
            type: 'button',
            'data-session-files-action': '',
            title: t('row.copy'),
            'aria-label': t('row.copy'),
            onClick: function (event) {
              event.stopPropagation()
              props.onCopy(entry)
            },
            style: {
              width: 28,
              height: 28,
              flex: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 7,
              border: 'none',
              background: 'transparent',
              color: TOKEN.labelTertiary,
              cursor: 'pointer',
              padding: 0,
            },
          },
          copyGlyph(14),
        ),
        h('span', { 'aria-hidden': true, style: { flex: 'none', color: TOKEN.labelCaption, display: 'inline-flex' } }, chevronGlyph(14)),
      )
    }

    /**
     * Empty state, shared by "nothing yet" and "nothing matches".
     * @param props - `{ t, searching, onClear }`.
     * @returns the empty element.
     */
    function EmptyState(props) {
      var t = props.t
      return h(
        'div',
        {
          style: {
            flex: '1 1 auto',
            minHeight: 240,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '32px 24px',
            textAlign: 'center',
          },
        },
        h(
          'span',
          {
            'aria-hidden': true,
            style: {
              width: 48,
              height: 48,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 14,
              background: TOKEN.bgLayer2,
              color: TOKEN.labelTertiary,
              marginBottom: 4,
            },
          },
          fileGlyph(24),
        ),
        h(
          'span',
          { style: { fontSize: 13.5, fontWeight: 500, lineHeight: '20px', color: TOKEN.labelSecondary } },
          t(props.searching ? 'empty.search' : 'empty.title'),
        ),
        props.searching
          ? h(
              'button',
              {
                type: 'button',
                'data-session-files-button': '',
                onClick: props.onClear,
                style: { ...headerButtonStyle(false), marginTop: 6 },
              },
              t('empty.clear'),
            )
          : h(
              'span',
              { style: { maxWidth: 360, fontSize: 12, lineHeight: '19px', color: TOKEN.labelTertiary } },
              t('empty.body'),
            ),
        props.searching
          ? null
          : h(
              'span',
              {
                style: {
                  maxWidth: 380,
                  marginTop: 4,
                  fontSize: 11.5,
                  lineHeight: '17px',
                  color: TOKEN.labelCaption,
                },
              },
              t('empty.hint'),
            ),
      )
    }

    /**
     * The Session files view.
     * @param props - slot props plus the injected `openFile` callback.
     * @returns the view element.
     */
    function SessionFilesView(props) {
      var t = typeof props.t === 'function' ? props.t : function (key) { return key }
      var useProjection = typeof props.useProjection === 'function' ? props.useProjection : function () { return undefined }
      var projection = useProjection('sessionFiles')
      var files = projection && Array.isArray(projection.files) ? projection.files : []
      var cwd = projection && typeof projection.cwd === 'string' ? projection.cwd : ''

      var queryState = react.useState('')
      var query = queryState[0]
      var setQuery = queryState[1]

      var filterState = react.useState('all')
      var filter = filterState[0]
      var setFilter = filterState[1]

      var noticeState = react.useState(null)
      var notice = noticeState[0]
      var setNotice = noticeState[1]

      react.useEffect(function () {
        if (notice === null) return undefined
        var timer = setTimeout(function () { setNotice(null) }, 2400)
        return function () { clearTimeout(timer) }
      }, [notice])

      var rows = react.useMemo(function () {
        return filterFiles(files, filter, query)
      }, [files, filter, query])

      var counts = react.useMemo(function () {
        return countByFilter(files)
      }, [files])

      var hasFiles = counts.all > 0
      var searching = hasFiles && rows.length === 0

      function report(kind, text) {
        setNotice({ kind: kind, text: text, at: Date.now() })
      }

      function openEntry(entry) {
        var opened = false
        try {
          opened = props.openFile(entry.path) === true
        } catch (error) {
          opened = false
        }
        if (!opened) report('error', t('notice.openFailed'))
      }

      function copyEntry(entry) {
        if (copyText(entry.path)) report('ok', t('row.copy') + ' · ' + entry.path)
        else report('error', t('notice.copyFailed'))
      }

      function copyAll() {
        if (files.length === 0) return
        var paths = files.map(function (entry) { return entry.path })
        if (copyText(paths.join('\n'))) report('ok', format(t, 'header.copied', { count: paths.length }))
        else report('error', t('notice.copyFailed'))
      }

      var filterChips = [
        { id: 'all', label: t('filter.all'), count: counts.all },
        { id: 'created', label: t('filter.created'), count: counts.created },
        { id: 'edited', label: t('filter.edited'), count: counts.edited },
        { id: 'presented', label: t('filter.presented'), count: counts.presented },
      ]

      return h(
        'div',
        {
          'data-session-files-view': '',
          'data-conversation-composer-overlay': '',
          style: ROOT_STYLE,
        },
        h('style', null, CSS_TEXT),
        h(
          'div',
          { style: HEADER_STYLE },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flex: '1 1 auto' } },
              h(
                'span',
                { style: { fontSize: 15, fontWeight: 600, lineHeight: '22px', color: TOKEN.labelPrimary } },
                t('header.title'),
              ),
              h(
                'span',
                {
                  style: {
                    fontSize: 12,
                    lineHeight: '18px',
                    color: TOKEN.labelTertiary,
                    fontVariantNumeric: 'tabular-nums',
                  },
                },
                format(t, 'count.files', { count: counts.all }),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 8, flex: 'none' } },
              h(
                'div',
                { style: { position: 'relative', display: 'inline-flex', alignItems: 'center' } },
                h(
                  'span',
                  {
                    'aria-hidden': true,
                    style: {
                      position: 'absolute',
                      left: 9,
                      display: 'inline-flex',
                      color: TOKEN.labelTertiary,
                      pointerEvents: 'none',
                    },
                  },
                  searchGlyph(14),
                ),
                h('input', {
                  'data-session-files-search': '',
                  type: 'search',
                  value: query,
                  placeholder: t('header.search'),
                  'aria-label': t('header.search'),
                  spellCheck: false,
                  autoComplete: 'off',
                  onChange: function (event) { setQuery(event.target.value) },
                  style: searchStyle(),
                }),
              ),
              h(
                'button',
                {
                  type: 'button',
                  'data-session-files-button': '',
                  onClick: copyAll,
                  disabled: files.length === 0,
                  title: t('header.copyAll'),
                  style: headerButtonStyle(files.length === 0),
                },
                copyGlyph(14),
                t('header.copyAll'),
              ),
            ),
          ),
          h(
            'div',
            { style: { fontSize: 12, lineHeight: '18px', color: TOKEN.labelTertiary } },
            t('header.subtitle'),
          ),
          h(
            'div',
            { role: 'tablist', 'aria-label': t('header.title'), style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
            filterChips.map(function (chip) {
              var active = filter === chip.id
              return h(
                'button',
                {
                  key: chip.id,
                  type: 'button',
                  role: 'tab',
                  'aria-selected': active,
                  'data-session-files-chip': '',
                  onClick: function () { setFilter(chip.id) },
                  style: chipStyle(active),
                },
                chip.label,
                h(
                  'span',
                  {
                    style: {
                      fontSize: 10.5,
                      lineHeight: '14px',
                      color: active ? TOKEN.labelTertiary : TOKEN.labelCaption,
                      fontVariantNumeric: 'tabular-nums',
                    },
                  },
                  String(chip.count),
                ),
              )
            }),
          ),
        ),
        h(
          'div',
          { 'data-session-files-scroll': '', style: LIST_STYLE },
          rows.length === 0
            ? h(EmptyState, {
                t: t,
                searching: searching,
                onClear: function () { setQuery(''); setFilter('all') },
              })
            : rows.map(function (entry, index) {
                return h(FileRow, {
                  key: entry.path + ':' + index,
                  entry: entry,
                  cwd: cwd,
                  t: t,
                  onCopy: copyEntry,
                  onOpen: openEntry,
                })
              }),
        ),
        notice !== null
          ? h(
              'div',
              {
                role: 'status',
                style: {
                  position: 'absolute',
                  left: '50%',
                  bottom: 18,
                  transform: 'translateX(-50%)',
                  maxWidth: 'calc(100% - 40px)',
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: '1px solid ' + TOKEN.borderL2,
                  background: TOKEN.bgLayer2,
                  color: notice.kind === 'error' ? TOKEN.danger : TOKEN.labelSecondary,
                  fontSize: 12,
                  lineHeight: '18px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  pointerEvents: 'none',
                  zIndex: 5,
                },
              },
              notice.text,
            )
          : null,
      )
    }

    /* ------------------------------------------------------------------ */
    /* Plugin                                                             */
    /* ------------------------------------------------------------------ */

    /**
     * Build the click handler that opens a file in the right sidebar.
     * @param ctx - client context.
     * @param sessionId - the Session whose files the view shows.
     * @returns a function from path to whether the preview was requested.
     */
    function makeOpener(ctx, sessionId) {
      return function (path) {
        var sidebar
        try {
          sidebar = ctx.get('sidebarRight')
        } catch (error) {
          sidebar = undefined
        }
        if (!sidebar || typeof sidebar.openResource !== 'function') return false
        var address = sessionFileAddress(sessionId, path)
        try {
          sidebar.openResource(address)
          return true
        } catch (error) {
          return false
        }
      }
    }

    /** Client plugin body. */
    var inject = ['slots', 'locale']

    /**
     * @param ctx - client context carrying slots and locale.
     */
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: ZH, en: EN })
      }, 'session-files: locale')

      var t = ctx.locale.bind(NS)

      ctx.slots.inject('conversation.view', function () {
        return ctx.slots.register(
          {
            name: 'conversation.view',
            id: SLOT_ID,
            order: VIEW_ORDER,
            locale: NS,
            label: function () { return t('view.label') },
            inject: function (sessionId) {
              return { openFile: makeOpener(ctx, sessionId) }
            },
          },
          SessionFilesView,
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    exports.__internals = {
      filterFiles: filterFiles,
      countByFilter: countByFilter,
      relativeTo: relativeTo,
      splitPath: splitPath,
      extensionOf: extensionOf,
      sessionFileAddress: sessionFileAddress,
      format: format,
    }

    return module.exports
  },
})