// dsh-agy-quota-chip — browser half
//
// Displays Antigravity 5-hour rolling and weekly quota details directly to the
// left of the model selector in the composer toolbar ('conversation.input.right').
//
// 1. Only displays when an Antigravity model is selected in the current session.
// 2. Shows both 5-hour rolling quota and 7-day weekly quota percentages with
//    color indicators (green/amber/red).
// 3. Hovering shows full details (account name, email, reset time).
// 4. Clicking calls up the Antigravity management console.

;(function (root) {
  'use strict'
  if (root === null || root === undefined) return
  if (typeof root.__ModuleLoader__ !== 'object' || root.__ModuleLoader__ === null) return

  root.__ModuleLoader__.load({
    id: 'dsh-agy-quota-chip',
    factory: (require) => {
      const module = { exports: {} }
      const exports = module.exports

      const React = require('react')
      const h = React.createElement

      const STATUS_CACHE_KEY = 'dsh_agy_status_cache'

      function ensureStyles() {
        if (typeof document === 'undefined') return
        if (document.getElementById('dsh-agy-quota-chip-style')) return
        const style = document.createElement('style')
        style.id = 'dsh-agy-quota-chip-style'
        style.textContent = `
          .dsh-agy-quota-pill {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            height: 24px;
            padding: 0 8px;
            border-radius: 9999px;
            border: 1px solid var(--dsw-alias-border, rgba(128, 128, 128, 0.22));
            background: var(--dsw-alias-bg-subtle, rgba(128, 128, 128, 0.08));
            color: var(--dsw-alias-label-primary, inherit);
            font-size: 11px;
            font-weight: 500;
            line-height: 1;
            cursor: pointer;
            user-select: none;
            transition: all 0.15s ease;
            white-space: nowrap;
            outline: none;
            box-sizing: border-box;
          }
          .dsh-agy-quota-pill:hover {
            background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.16));
            border-color: var(--dsw-alias-border-hover, rgba(128, 128, 128, 0.38));
            transform: translateY(-0.5px);
          }
          .dsh-agy-quota-pill:active {
            transform: translateY(0);
          }
          .dsh-agy-quota-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            flex-shrink: 0;
            transition: background-color 0.2s ease;
          }
          .dsh-agy-quota-part {
            display: inline-flex;
            align-items: center;
          }
          .dsh-agy-quota-lbl {
            opacity: 0.75;
            font-size: 10.5px;
            margin-right: 2px;
          }
          .dsh-agy-quota-val {
            font-weight: 650;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
          }
          .dsh-agy-quota-sep {
            opacity: 0.35;
            margin: 0 1px;
            font-size: 10px;
          }
          /* 修复模态弹窗打开时的视口右侧空白与整体向左偏移问题 */
          html.agy-modal-open,
          html.agy-modal-open body {
            overflow: initial !important;
            scrollbar-gutter: auto !important;
          }
          html.agy-modal-open [data-conversation-scroll] {
            scrollbar-gutter: auto !important;
          }
        `
        document.head.appendChild(style)
      }

      function modelFamilyOf(modelId) {
        if (!modelId) return 'google'
        const id = String(modelId).toLowerCase()
        if (id.includes('argon')) return 'argon'
        if (id.startsWith('claude-') || id.includes('claude')) return 'anthropic'
        if (id.startsWith('gemini-') || id.startsWith('gemma-') || id.includes('gemini')) return 'google'
        if (id.startsWith('gpt-') || id.startsWith('openai/') || id.includes('gpt-oss')) return 'openai'
        return 'google'
      }

      function formatResetTime(iso) {
        if (!iso) return ''
        try {
          const t = new Date(iso).getTime()
          if (!Number.isFinite(t)) return ''
          const diffMs = t - Date.now()
          if (diffMs <= 0) return '已重置'
          const diffMin = Math.round(diffMs / 60000)
          if (diffMin < 60) return `${diffMin}分钟后`
          const diffHours = (diffMs / 3600000).toFixed(1)
          if (diffHours < 24) return `${diffHours}小时后`
          const diffDays = Math.ceil(diffMs / 86400000)
          return `${diffDays}天后`
        } catch {
          return ''
        }
      }

      function getQuotaColor(pct) {
        if (pct === null || pct === undefined) return '#94a3b8'
        if (pct <= 20) return '#ef4444' // red
        if (pct <= 50) return '#f59e0b' // amber
        return '#10b981' // green
      }

      function loadCachedStatus() {
        try {
          const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(STATUS_CACHE_KEY) : null
          if (raw) return JSON.parse(raw)
        } catch {}
        return null
      }

      function useAgyQuotaStatus() {
        const [status, setStatus] = React.useState(loadCachedStatus)

        React.useEffect(() => {
          let live = true
          const check = async () => {
            try {
              const cached = loadCachedStatus()
              if (cached && live) setStatus(cached)
            } catch {}

            try {
              const res = await fetch('/plugins/agy-link/status')
              if (res.ok && live) {
                const data = await res.json()
                if (data && typeof data === 'object') {
                  setStatus(data)
                  try {
                    window.localStorage?.setItem(STATUS_CACHE_KEY, JSON.stringify(data))
                  } catch {}
                }
              }
            } catch {}
          }

          check()
          const timer = setInterval(check, 6000)
          const onFocus = () => { check() }
          window.addEventListener('focus', onFocus)
          return () => {
            live = false
            clearInterval(timer)
            window.removeEventListener('focus', onFocus)
          }
        }, [])

        return status
      }

      function AgyInputQuotaChip({ sessionId, useProjection, ctx }) {
        const status = useAgyQuotaStatus()

        // 1. Resolve model directory for this session to track reactive model changes
        const modelDirs = typeof ctx?.get === 'function' ? ctx.get('modelDirectories') : ctx?.modelDirectories
        const directory = (modelDirs && sessionId) ? modelDirs.directoryFor(sessionId) : null

        const [dirSelection, setDirSelection] = React.useState(() => {
          return directory?.store ? directory.store.getSnapshot()?.current : null
        })

        React.useEffect(() => {
          if (!directory?.store) return
          setDirSelection(directory.store.getSnapshot()?.current ?? null)
          return directory.store.subscribe(() => {
            setDirSelection(directory.store.getSnapshot()?.current ?? null)
          })
        }, [directory])

        // 2. Also check durable projected selection
        const projected = typeof useProjection === 'function' ? useProjection('modelSelection') : null
        const currentSelection = dirSelection || projected

        // Condition: "2 仅选中模型显示"
        if (!currentSelection) return null
        if (currentSelection.provider !== 'antigravity') return null

        if (!status) return null

        const modelId = currentSelection.model || ''
        const family = modelFamilyOf(modelId)
        const pool = status.pool
        const accounts = pool?.accounts || []
        const rawActiveId = pool?.resolvedActiveAccountIds?.[family]
          || (family === 'google' ? pool?.activeAccountId || pool?.lastActiveAccountId || pool?.primaryAccountId : pool?.activeAccountIds?.[family])
          || pool?.activeAccountId
          || pool?.primaryAccountId

        const activeAcc = (rawActiveId ? accounts.find((a) => a.id === rawActiveId) : null) || accounts[0]
        if (!activeAcc) return null

        const familyQuota = activeAcc.quotas?.[family]
        const fiveHourFrac = familyQuota?.remainingFraction
        const fiveHourPct = typeof fiveHourFrac === 'number' && Number.isFinite(fiveHourFrac)
          ? Math.max(0, Math.min(100, Math.round(fiveHourFrac * 100)))
          : null
        const fiveHourReset = familyQuota?.resetTime

        const weeklyFrac = familyQuota?.weeklyFraction
        const weeklyPct = typeof weeklyFrac === 'number' && Number.isFinite(weeklyFrac)
          ? Math.max(0, Math.min(100, Math.round(weeklyFrac * 100)))
          : null
        const weeklyReset = familyQuota?.weeklyResetTime

        const argonQuota = activeAcc.quotas?.argon
        const argonWeeklyFrac = argonQuota?.weeklyFraction
        const argonWeeklyPct = typeof argonWeeklyFrac === 'number' && Number.isFinite(argonWeeklyFrac)
          ? Math.max(0, Math.min(100, Math.round(argonWeeklyFrac * 100)))
          : null

        const isAuthRequired = activeAcc.auth?.needsLogin || activeAcc.authRequired === true
        const now = Date.now()
        const cooldownUntil = activeAcc.cooldowns?.[family] || activeAcc.cooldowns?.all
        const isCooldown = typeof cooldownUntil === 'number' && cooldownUntil > now
        const cooldownSec = isCooldown ? Math.ceil((cooldownUntil - now) / 1000) : 0

        let dotColor = '#10b981'
        let statusBadgeText = null

        if (isAuthRequired) {
          dotColor = '#ef4444'
          statusBadgeText = '需重登'
        } else if (isCooldown) {
          dotColor = '#f59e0b'
          statusBadgeText = `冷却 ${Math.floor(cooldownSec / 60)}:${String(cooldownSec % 60).padStart(2, '0')}`
        } else {
          const minPct = Math.min(fiveHourPct ?? 100, weeklyPct ?? 100)
          dotColor = getQuotaColor(minPct)
        }

        // Rich Tooltip
        const accName = activeAcc.alias || (activeAcc.systemHome ? '主账号 (系统登录)' : 'Antigravity')
        const accEmail = activeAcc.email ? ` (${activeAcc.email})` : ''
        const tooltipLines = [
          `Antigravity 额度状态`,
          `━━━━━━━━━━━━━━━━━━━━━━━`,
          `当前账号: ${accName}${accEmail}`,
          `当前模型: ${modelId} [${family}]`,
          `───────────────────────`,
          `⏱️ 5小时滚动额度: ${fiveHourPct !== null ? `${fiveHourPct}%` : '未计量/无限'}${fiveHourReset ? ` (${formatResetTime(fiveHourReset)}重置)` : ''}`,
          `📅 7天周额度:     ${weeklyPct !== null ? `${weeklyPct}%` : '未计量/无限'}${weeklyReset ? ` (${formatResetTime(weeklyReset)}重置)` : ''}`,
        ]
        if (argonWeeklyPct !== null && family !== 'argon') {
          tooltipLines.push(`⚡ Argon 独立周池: ${argonWeeklyPct}%`)
        }
        tooltipLines.push(`━━━━━━━━━━━━━━━━━━━━━━━`)
        tooltipLines.push(`👉 点击打开 Antigravity 管理控制台`)
        const tooltipText = tooltipLines.join('\n')

        // Condition: "3 呼出管理控制台"
        const handleClick = (e) => {
          e.preventDefault()
          e.stopPropagation()

          if (window.__agyModalStore && typeof window.__agyModalStore.setOpen === 'function') {
            window.__agyModalStore.setOpen(true)
            return
          }
          if (typeof window.__agyOpenConsole === 'function') {
            window.__agyOpenConsole()
            return
          }
          const headerBtn = document.querySelector('.agy-session-status-btn') || document.querySelector('button.agy-btn')
          if (headerBtn && typeof headerBtn.click === 'function') {
            headerBtn.click()
          }
        }

        const elements = [
          h('span', {
            key: 'dot',
            className: 'dsh-agy-quota-dot',
            style: { backgroundColor: dotColor },
          }),
        ]

        if (statusBadgeText) {
          elements.push(
            h('span', { key: 'badge', className: 'dsh-agy-quota-val', style: { color: dotColor } }, statusBadgeText)
          )
        } else {
          if (fiveHourPct !== null) {
            elements.push(
              h('span', { key: '5h', className: 'dsh-agy-quota-part' }, [
                h('span', { key: '5h-lbl', className: 'dsh-agy-quota-lbl' }, '5h:'),
                h('span', { key: '5h-val', className: 'dsh-agy-quota-val', style: { color: getQuotaColor(fiveHourPct) } }, `${fiveHourPct}%`),
              ])
            )
          }

          if (fiveHourPct !== null && weeklyPct !== null) {
            elements.push(
              h('span', { key: 'sep', className: 'dsh-agy-quota-sep' }, '·')
            )
          }

          if (weeklyPct !== null) {
            elements.push(
              h('span', { key: 'w', className: 'dsh-agy-quota-part' }, [
                h('span', { key: 'w-lbl', className: 'dsh-agy-quota-lbl' }, '周:'),
                h('span', { key: 'w-val', className: 'dsh-agy-quota-val', style: { color: getQuotaColor(weeklyPct) } }, `${weeklyPct}%`),
              ])
            )
          }

          if (fiveHourPct === null && weeklyPct === null) {
            elements.push(
              h('span', { key: 'txt', className: 'dsh-agy-quota-val' }, 'AGY')
            )
          }
        }

        const button = h(
          'button',
          {
            type: 'button',
            className: 'dsh-agy-quota-pill',
            title: tooltipText,
            'aria-label': tooltipText,
            onClick: handleClick,
          },
          elements
        )

        return button
      }

      function apply(ctx) {
        ensureStyles()
        if (!ctx.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return

        ctx.effect(() => {
          return ctx.slots.inject('conversation.input.right', () => {
            return ctx.slots.register(
              {
                name: 'conversation.input.right',
                id: 'agy-quota-chip',
                order: 90,
                inject: (sessionId) => ({ sessionId }),
              },
              (props) => h(AgyInputQuotaChip, { ...props, ctx })
            )
          })
        }, 'dsh-agy-quota-chip: composer chip')
      }

      exports.inject = ['slots']
      exports.apply = apply
      return module.exports
    },
  })
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null)
