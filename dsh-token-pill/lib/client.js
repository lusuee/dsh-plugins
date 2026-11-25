// dsh-token-pill — browser half.
//
// Displays a minimal, clean token usage pill in the session header utilities:
// e.g. [ ⚡ 38.2k · 缓 96% ]
//
// 1. Reads DSH native reactive projections: `tokenUsage` & `sessionStats`.
// 2. Automatically hidden on 0 tokens / blank sessions (zero clutter).
// 3. Hovering shows a rich, structured breakdown: output, uncached input,
//    cache hit rate, last turn metrics, turns, model execution time.
// 4. Clicking copies the full report to clipboard with a brief toast.
// 5. Zero external network requests, zero database bloat, zero pricing guesswork.

;(function (root) {
  'use strict'
  if (root === null || root === undefined) return
  if (typeof root.__ModuleLoader__ !== 'object' || root.__ModuleLoader__ === null) return

  root.__ModuleLoader__.load({
    id: 'dsh-token-pill',
    factory: (require) => {
      const module = { exports: {} }
      const exports = module.exports

      const React = require('react')
      const h = React.createElement

      const STYLE_ID = 'dsh-token-pill-style'
      const STYLE = `
        .dsh-tp-group {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
        }
        .dsh-tp-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          height: 24px;
          padding: 0 8px;
          border-radius: 9999px;
          border: 1px solid var(--dsw-alias-border, rgba(128, 128, 128, 0.22));
          background: var(--dsw-alias-bg-subtle, rgba(128, 128, 128, 0.08));
          color: var(--dsw-alias-label-primary, inherit);
          font: inherit;
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
        .dsh-tp-btn:hover {
          background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.16));
          border-color: var(--dsw-alias-border-hover, rgba(128, 128, 128, 0.38));
          transform: translateY(-0.5px);
        }
        .dsh-tp-btn:active {
          transform: translateY(0);
        }
        .dsh-tp-icon {
          font-size: 11px;
          line-height: 1;
          color: var(--dsw-alias-brand, #3b82f6);
        }
        .dsh-tp-main {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .dsh-tp-cache {
          font-variant-numeric: tabular-nums;
          color: var(--dsw-alias-state-success, #10b981);
          font-size: 10.5px;
          font-weight: 500;
        }
        .dsh-tp-toast {
          padding: 0 4px;
          font-size: 11px;
          font-weight: 500;
          color: var(--dsw-alias-state-success, #10b981);
          white-space: nowrap;
          animation: dsh-tp-fadeIn 0.15s ease;
        }
        @keyframes dsh-tp-fadeIn {
          from { opacity: 0; transform: translateX(-2px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `

      function ensureStyle() {
        if (typeof document === 'undefined') return
        const existing = document.getElementById(STYLE_ID)
        if (existing) {
          if (existing.textContent !== STYLE) existing.textContent = STYLE
          return
        }
        const tag = document.createElement('style')
        tag.id = STYLE_ID
        tag.textContent = STYLE
        document.head.appendChild(tag)
      }

      function formatTokens(num) {
        if (!num || num <= 0) return '0'
        if (num >= 1000000) {
          return (num / 1000000).toFixed(2).replace(/\.00$/, '') + 'M'
        }
        if (num >= 1000) {
          return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
        }
        return String(num)
      }

      function TokenPillAction(props) {
        const useProjection = typeof props.useProjection === 'function' ? props.useProjection : null
        const rawUsage = useProjection ? useProjection('tokenUsage') : null
        const rawStats = useProjection ? useProjection('sessionStats') : null

        const tokenUsage = rawUsage && rawUsage.val ? rawUsage.val : rawUsage
        const sessionStats = rawStats && rawStats.val ? rawStats.val : rawStats

        const [copied, setCopied] = React.useState(false)

        React.useEffect(() => {
          if (!copied) return undefined
          const timer = setTimeout(() => setCopied(false), 2000)
          return () => clearTimeout(timer)
        }, [copied])

        const totals = tokenUsage?.totals
        const uncached = Number(totals?.uncachedInputTokens || 0)
        const output = Number(totals?.outputTokens || 0)
        const cacheRead = Number(totals?.cacheReadTokens || 0)
        const cacheWrite = Number(totals?.cacheWriteTokens || 0)
        const totalInput = uncached + cacheRead
        const totalTokens = totalInput + output

        // If no tokens have been consumed (new or empty conversation), don't show the pill
        if (totalTokens <= 0) return null

        const cachePct = totalInput > 0 ? (cacheRead / totalInput) * 100 : 0

        // Last turn details
        const last = tokenUsage?.last
        const lastTurn = last?.turn
        const lastStep = last?.step
        const lastBuckets = last?.buckets
        const lastUncached = Number(lastBuckets?.uncachedInputTokens || 0)
        const lastOutput = Number(lastBuckets?.outputTokens || 0)
        const lastCacheRead = Number(lastBuckets?.cacheReadTokens || 0)
        const lastTotalInput = lastUncached + lastCacheRead
        const lastCachePct = lastTotalInput > 0 ? (lastCacheRead / lastTotalInput) * 100 : 0

        // Session metrics
        const turns = sessionStats?.turns || 0
        const steps = sessionStats?.steps || 0
        const llmMs = sessionStats?.llmMs || 0
        const ttftMs = sessionStats?.ttftMs || 0
        const ttftSteps = sessionStats?.ttftSteps || 0

        // Build rich tooltip
        const tooltipLines = [
          '📊 Token 用量统计 (点击复制)',
          '─────────────────────────',
          `总消耗: ${formatTokens(totalTokens)} (${totalTokens.toLocaleString()} tokens)`,
          `• 补全输出: ${formatTokens(output)} (${output.toLocaleString()})`,
          `• 未缓存输入: ${formatTokens(uncached)} (${uncached.toLocaleString()})`,
          `• 缓存读取: ${formatTokens(cacheRead)} (${cacheRead.toLocaleString()}) [${cachePct.toFixed(1)}%]`,
        ]
        if (cacheWrite > 0) {
          tooltipLines.push(`• 写入缓存: ${formatTokens(cacheWrite)} (${cacheWrite.toLocaleString()})`)
        }
        if (lastBuckets) {
          tooltipLines.push('─────────────────────────')
          tooltipLines.push(`⏱️ 最近一轮 (#${lastTurn ?? '?'} 轮 · 第 ${lastStep ?? '?'} 步):`)
          tooltipLines.push(`• 补全输出: ${formatTokens(lastOutput)} (${lastOutput.toLocaleString()})`)
          tooltipLines.push(
            `• 输入: ${formatTokens(lastUncached)} 未缓存 / ${formatTokens(lastCacheRead)} 命中 [${lastCachePct.toFixed(1)}%]`,
          )
        }
        if (turns > 0 || steps > 0 || llmMs > 0) {
          tooltipLines.push('─────────────────────────')
          const scaleParts = []
          if (turns > 0) scaleParts.push(`${turns} 轮对话`)
          if (steps > 0) scaleParts.push(`${steps} 次调用`)
          if (scaleParts.length > 0) tooltipLines.push(`📈 会话规模: ${scaleParts.join(' · ')}`)
          if (llmMs > 0) {
            const durMin = (llmMs / 60000).toFixed(1)
            const avgTtft = ttftSteps > 0 ? (ttftMs / ttftSteps / 1000).toFixed(1) + 's' : ''
            tooltipLines.push(`⚡ 模型耗时: ${durMin} 分钟${avgTtft ? ` (首字平均 ${avgTtft})` : ''}`)
          }
        }
        const tooltip = tooltipLines.join('\n')

        const handleCopy = (e) => {
          e.stopPropagation()
          try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(tooltip)
              setCopied(true)
            }
          } catch {}
        }

        // Pill label formatting
        const children = [
          h('span', { key: 'icon', className: 'dsh-tp-icon' }, '⚡'),
        ]

        if (output > 0 && cacheRead > 0) {
          children.push(
            h('span', { key: 'output', className: 'dsh-tp-main' }, formatTokens(output)),
            h('span', { key: 'sep', className: 'dsh-tp-cache' }, ` · 缓 ${cachePct >= 99.5 ? '99+' : Math.round(cachePct)}%`),
          )
        } else if (output > 0 && uncached > 0) {
          children.push(
            h('span', { key: 'both', className: 'dsh-tp-main' }, `${formatTokens(output)} 出 · ${formatTokens(uncached)} 入`),
          )
        } else if (output > 0) {
          children.push(
            h('span', { key: 'output', className: 'dsh-tp-main' }, `${formatTokens(output)} 出`),
          )
        } else {
          children.push(
            h('span', { key: 'total', className: 'dsh-tp-main' }, `${formatTokens(totalTokens)} token`),
          )
        }

        return h('span', { className: 'dsh-tp-group' }, [
          h(
            'button',
            {
              key: 'btn',
              type: 'button',
              className: 'dsh-tp-btn',
              title: tooltip,
              'aria-label': tooltip,
              onClick: handleCopy,
            },
            children,
          ),
          copied
            ? h('span', { key: 'toast', className: 'dsh-tp-toast' }, '已复制')
            : null,
        ])
      }

      function apply(ctx) {
        ensureStyle()
        if (!ctx.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return
        ctx.effect(() => {
          return ctx.slots.inject('conversation.session.header.utilities', () => {
            return ctx.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'token-pill',
                order: -5,
                label: () => 'Token 用量',
              },
              TokenPillAction,
            )
          })
        }, 'dsh-token-pill: header token pill')
      }

      exports.inject = ['slots']
      exports.apply = apply
      return module.exports
    },
  })
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null)
