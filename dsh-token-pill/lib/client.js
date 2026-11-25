// dsh-token-pill — browser half.
//
// Displays a minimal, clean token usage pill in the composer toolbar and session header:
// e.g. [ ⚡ 38.2k · 缓 96% ]
//
// Clicking the pill opens a comprehensive, beautiful Token Usage Modal:
// - 【当前会话】：实时输出量、输入量、缓存读取量、命中率、最近一轮开销、会话耗时
// - 【全局统计】：今日 / 最近 7 天 / 最近 30 天汇总，每日消耗走势明细，活跃会话 TOP 5
// - 【一键复制】：将当前视图格式化为清晰的文本报告

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

      const STATS_ROUTE = '/__dsh-token-pill/stats'
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
          gap: 4px;
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
        .dsh-tp-btn-empty {
          opacity: 0.72;
        }
        .dsh-tp-btn-empty:hover {
          opacity: 1;
        }
        .dsh-tp-icon {
          font-size: 11px;
          line-height: 1;
          color: var(--dsw-alias-brand, #3b82f6);
        }
        .dsh-tp-icon-dim {
          opacity: 0.65;
        }
        .dsh-tp-main {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .dsh-tp-dim {
          opacity: 0.75;
          font-weight: 500;
        }
        .dsh-tp-cache {
          font-variant-numeric: tabular-nums;
          color: var(--dsw-alias-state-success, #10b981);
          font-size: 10.5px;
          font-weight: 500;
        }

        /* Modal Styles */
        .dsh-tp-overlay {
          position: fixed;
          inset: 0;
          z-index: 99999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.52);
          backdrop-filter: blur(4px);
          animation: dsh-tp-modalFadeIn 0.15s ease-out;
        }
        .dsh-tp-dialog {
          width: 600px;
          max-width: 92vw;
          max-height: 85vh;
          border-radius: 12px;
          background: var(--dsw-alias-bg-floating, #1c1c1f);
          border: 1px solid var(--dsw-alias-border, rgba(128, 128, 128, 0.22));
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.38);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          color: var(--dsw-alias-label-primary, inherit);
          font: inherit;
          box-sizing: border-box;
          animation: dsh-tp-modalPopIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes dsh-tp-modalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes dsh-tp-modalPopIn {
          from { opacity: 0; transform: scale(0.96) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        .dsh-tp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 18px;
          border-bottom: 1px solid var(--dsw-alias-border, rgba(128, 128, 128, 0.15));
        }
        .dsh-tp-title {
          font-size: 14px;
          font-weight: 650;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .dsh-tp-close-btn {
          background: transparent;
          border: 0;
          color: var(--dsw-alias-label-secondary, #8e8e93);
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          transition: all 0.15s;
        }
        .dsh-tp-close-btn:hover {
          color: var(--dsw-alias-label-primary, inherit);
          background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.15));
        }

        .dsh-tp-tabs {
          display: flex;
          align-items: center;
          padding: 10px 18px 0;
          gap: 8px;
          border-bottom: 1px solid var(--dsw-alias-border, rgba(128, 128, 128, 0.1));
        }
        .dsh-tp-tab {
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 550;
          cursor: pointer;
          border: 0;
          background: transparent;
          color: var(--dsw-alias-label-secondary, #8e8e93);
          border-bottom: 2px solid transparent;
          transition: all 0.15s;
        }
        .dsh-tp-tab:hover {
          color: var(--dsw-alias-label-primary, inherit);
        }
        .dsh-tp-tab-active {
          color: var(--dsw-alias-brand, #3b82f6);
          border-bottom-color: var(--dsw-alias-brand, #3b82f6);
        }

        .dsh-tp-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .dsh-tp-subtabs {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .dsh-tp-subtab {
          padding: 3px 10px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid var(--dsw-alias-border, rgba(128, 128, 128, 0.2));
          background: var(--dsw-alias-bg-subtle, rgba(128, 128, 128, 0.08));
          color: var(--dsw-alias-label-secondary, inherit);
          transition: all 0.15s;
        }
        .dsh-tp-subtab:hover {
          color: var(--dsw-alias-label-primary, inherit);
        }
        .dsh-tp-subtab-active {
          background: var(--dsw-alias-brand, #3b82f6);
          color: #ffffff;
          border-color: var(--dsw-alias-brand, #3b82f6);
        }

        /* Metric Cards Grid */
        .dsh-tp-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        .dsh-tp-card {
          padding: 10px 12px;
          border-radius: 8px;
          background: var(--dsw-alias-bg-subtle, rgba(128, 128, 128, 0.07));
          border: 1px solid var(--dsw-alias-border, rgba(128, 128, 128, 0.12));
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .dsh-tp-card-title {
          font-size: 11px;
          color: var(--dsw-alias-label-secondary, #8e8e93);
          font-weight: 500;
        }
        .dsh-tp-card-val {
          font-size: 16px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .dsh-tp-card-sub {
          font-size: 10.5px;
          color: var(--dsw-alias-label-secondary, #8e8e93);
          font-variant-numeric: tabular-nums;
        }

        /* Section block */
        .dsh-tp-sec {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .dsh-tp-sec-title {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--dsw-alias-label-secondary, #8e8e93);
        }

        /* Table & List */
        .dsh-tp-table-wrap {
          border-radius: 8px;
          border: 1px solid var(--dsw-alias-border, rgba(128, 128, 128, 0.15));
          overflow: hidden;
          max-height: 200px;
          overflow-y: auto;
        }
        .dsh-tp-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
          text-align: left;
        }
        .dsh-tp-table th {
          background: var(--dsw-alias-bg-subtle, rgba(128, 128, 128, 0.1));
          padding: 6px 10px;
          font-weight: 600;
          color: var(--dsw-alias-label-secondary, #8e8e93);
          position: sticky;
          top: 0;
          z-index: 1;
        }
        .dsh-tp-table td {
          padding: 6px 10px;
          border-top: 1px solid var(--dsw-alias-border, rgba(128, 128, 128, 0.08));
          font-variant-numeric: tabular-nums;
        }
        .dsh-tp-table tr:hover td {
          background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.08));
        }

        /* Session Item */
        .dsh-tp-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          border-radius: 6px;
          background: var(--dsw-alias-bg-subtle, rgba(128, 128, 128, 0.05));
          font-size: 11.5px;
        }
        .dsh-tp-item-title {
          max-width: 260px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 500;
        }
        .dsh-tp-item-stats {
          font-variant-numeric: tabular-nums;
          color: var(--dsw-alias-label-secondary, #8e8e93);
          font-size: 11px;
        }

        /* Footer */
        .dsh-tp-footer {
          padding: 10px 18px;
          border-top: 1px solid var(--dsw-alias-border, rgba(128, 128, 128, 0.15));
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--dsw-alias-bg-subtle, rgba(128, 128, 128, 0.04));
        }
        .dsh-tp-btn-copy {
          padding: 5px 12px;
          border-radius: 6px;
          font-size: 11.5px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid var(--dsw-alias-border, rgba(128, 128, 128, 0.25));
          background: var(--dsw-alias-bg-subtle, rgba(128, 128, 128, 0.1));
          color: var(--dsw-alias-label-primary, inherit);
          display: flex;
          align-items: center;
          gap: 5px;
          transition: all 0.15s;
        }
        .dsh-tp-btn-copy:hover {
          background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.2));
        }
        .dsh-tp-btn-done {
          padding: 5px 16px;
          border-radius: 6px;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          border: 0;
          background: var(--dsw-alias-brand, #3b82f6);
          color: #ffffff;
          transition: opacity 0.15s;
        }
        .dsh-tp-btn-done:hover {
          opacity: 0.9;
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
        if (num >= 1000000000) {
          return (num / 1000000000).toFixed(2).replace(/\.00$/, '') + 'B'
        }
        if (num >= 1000000) {
          return (num / 1000000).toFixed(2).replace(/\.00$/, '') + 'M'
        }
        if (num >= 1000) {
          return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
        }
        return String(num)
      }

      function TokenStatsModal({ isOpen, onClose, sessionData, globalData, onRefreshGlobal }) {
        const [tab, setTab] = React.useState('session')
        const [globalRange, setGlobalRange] = React.useState('week')
        const [copied, setCopied] = React.useState(false)

        React.useEffect(() => {
          if (!isOpen) return
          const onKey = (e) => {
            if (e.key === 'Escape') onClose()
          }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }, [isOpen, onClose])

        React.useEffect(() => {
          if (!copied) return
          const t = setTimeout(() => setCopied(false), 2000)
          return () => clearTimeout(t)
        }, [copied])

        if (!isOpen) return null

        const currentRangeData =
          globalData && globalData[globalRange]
            ? globalData[globalRange]
            : { total: 0, output: 0, input: 0, cacheRead: 0, cachePct: 0, calls: 0 }

        const rangeLabel =
          globalRange === 'today' ? '今日' : globalRange === 'week' ? '最近 7 天 (周)' : '最近 30 天 (月)'

        const getReportText = () => {
          if (tab === 'session') {
            return [
              `📊 【当前会话 Token 用量明细】`,
              `─────────────────────────`,
              `总消耗: ${formatTokens(sessionData.totalTokens)} (${sessionData.totalTokens.toLocaleString()} tokens)`,
              `• 补全输出: ${formatTokens(sessionData.output)} (${sessionData.output.toLocaleString()})`,
              `• 未缓存输入: ${formatTokens(sessionData.uncached)} (${sessionData.uncached.toLocaleString()})`,
              `• 缓存读取: ${formatTokens(sessionData.cacheRead)} (${sessionData.cacheRead.toLocaleString()}) [${sessionData.cachePct.toFixed(1)}%]`,
              sessionData.lastBuckets
                ? `⏱️ 最近一轮 (#${sessionData.lastTurn} 轮 · 第 ${sessionData.lastStep} 步): 输出 ${formatTokens(sessionData.lastOutput)}, 输入 ${formatTokens(sessionData.lastUncached)} / 缓存 ${formatTokens(sessionData.lastCacheRead)}`
                : '',
              sessionData.turns > 0 ? `会话规模: ${sessionData.turns} 轮对话 · ${sessionData.steps} 次模型调用` : '',
            ]
              .filter(Boolean)
              .join('\n')
          } else {
            return [
              `📊 【全局 Token 用量统计 · ${rangeLabel}】`,
              `─────────────────────────`,
              `总消耗: ${formatTokens(currentRangeData.total)} (${currentRangeData.total.toLocaleString()} tokens)`,
              `• 补全输出: ${formatTokens(currentRangeData.output)} (${currentRangeData.output.toLocaleString()})`,
              `• 未缓存输入: ${formatTokens(currentRangeData.input)} (${currentRangeData.input.toLocaleString()})`,
              `• 缓存读取: ${formatTokens(currentRangeData.cacheRead)} (${currentRangeData.cacheRead.toLocaleString()}) [${currentRangeData.cachePct.toFixed(1)}%]`,
              `• 模型交互次数: ${currentRangeData.calls.toLocaleString()} 次`,
            ].join('\n')
          }
        }

        const handleCopy = () => {
          try {
            navigator.clipboard.writeText(getReportText())
            setCopied(true)
          } catch {}
        }

        return h('div', { className: 'dsh-tp-overlay', onClick: onClose }, [
          h(
            'div',
            {
              key: 'dialog',
              className: 'dsh-tp-dialog',
              onClick: (e) => e.stopPropagation(),
            },
            [
              // Header
              h('div', { key: 'header', className: 'dsh-tp-header' }, [
                h('div', { key: 'title', className: 'dsh-tp-title' }, [
                  h('span', { key: 'icon', style: { color: '#3b82f6' } }, '⚡'),
                  h('span', { key: 'txt' }, 'Token 用量统计与分析'),
                ]),
                h(
                  'button',
                  {
                    key: 'close',
                    type: 'button',
                    className: 'dsh-tp-close-btn',
                    onClick: onClose,
                    'aria-label': '关闭',
                  },
                  '✕',
                ),
              ]),

              // Tabs
              h('div', { key: 'tabs', className: 'dsh-tp-tabs' }, [
                h(
                  'button',
                  {
                    key: 't-session',
                    type: 'button',
                    className: `dsh-tp-tab ${tab === 'session' ? 'dsh-tp-tab-active' : ''}`,
                    onClick: () => setTab('session'),
                  },
                  '📑 当前会话',
                ),
                h(
                  'button',
                  {
                    key: 't-global',
                    type: 'button',
                    className: `dsh-tp-tab ${tab === 'global' ? 'dsh-tp-tab-active' : ''}`,
                    onClick: () => setTab('global'),
                  },
                  '🌐 全局统计 (周/月)',
                ),
              ]),

              // Body
              h(
                'div',
                { key: 'body', className: 'dsh-tp-body' },
                tab === 'session'
                  ? [
                      // Session Grid
                      h('div', { key: 'grid', className: 'dsh-tp-grid' }, [
                        h('div', { key: 'c1', className: 'dsh-tp-card' }, [
                          h('span', { className: 'dsh-tp-card-title' }, '总消耗量 (Total)'),
                          h('span', { className: 'dsh-tp-card-val' }, formatTokens(sessionData.totalTokens)),
                          h(
                            'span',
                            { className: 'dsh-tp-card-sub' },
                            `${sessionData.totalTokens.toLocaleString()} tokens`,
                          ),
                        ]),
                        h('div', { key: 'c2', className: 'dsh-tp-card' }, [
                          h('span', { className: 'dsh-tp-card-title' }, '补全输出 (Output)'),
                          h(
                            'span',
                            { className: 'dsh-tp-card-val', style: { color: '#3b82f6' } },
                            formatTokens(sessionData.output),
                          ),
                          h(
                            'span',
                            { className: 'dsh-tp-card-sub' },
                            `${sessionData.output.toLocaleString()} tokens`,
                          ),
                        ]),
                        h('div', { key: 'c3', className: 'dsh-tp-card' }, [
                          h('span', { className: 'dsh-tp-card-title' }, '缓存命中率 (Cache Hit)'),
                          h(
                            'span',
                            { className: 'dsh-tp-card-val', style: { color: '#10b981' } },
                            `${sessionData.cachePct.toFixed(1)}%`,
                          ),
                          h(
                            'span',
                            { className: 'dsh-tp-card-sub' },
                            `读取 ${formatTokens(sessionData.cacheRead)} tokens`,
                          ),
                        ]),
                        h('div', { key: 'c4', className: 'dsh-tp-card' }, [
                          h('span', { className: 'dsh-tp-card-title' }, '未缓存输入 (Input)'),
                          h('span', { className: 'dsh-tp-card-val' }, formatTokens(sessionData.uncached)),
                          h(
                            'span',
                            { className: 'dsh-tp-card-sub' },
                            `${sessionData.uncached.toLocaleString()} tokens`,
                          ),
                        ]),
                      ]),

                      // Last Turn Breakdown
                      sessionData.lastBuckets
                        ? h('div', { key: 'last-turn', className: 'dsh-tp-sec' }, [
                            h(
                              'span',
                              { className: 'dsh-tp-sec-title' },
                              `⏱️ 最近一轮 (#${sessionData.lastTurn} 轮 · 第 ${sessionData.lastStep} 步)`,
                            ),
                            h('div', { className: 'dsh-tp-item' }, [
                              h('span', null, `输出 ${formatTokens(sessionData.lastOutput)} tokens`),
                              h(
                                'span',
                                { className: 'dsh-tp-item-stats' },
                                `输入: ${formatTokens(sessionData.lastUncached)} 未缓存 / ${formatTokens(sessionData.lastCacheRead)} 命中 [${sessionData.lastCachePct.toFixed(1)}%]`,
                              ),
                            ]),
                          ])
                        : null,

                      // Session Stats Info
                      sessionData.turns > 0 || sessionData.llmMs > 0
                        ? h('div', { key: 'session-info', className: 'dsh-tp-sec' }, [
                            h('span', { className: 'dsh-tp-sec-title' }, '📈 会话规模与效率'),
                            h('div', { className: 'dsh-tp-item' }, [
                              h('span', null, `轮次: ${sessionData.turns} 轮 · ${sessionData.steps} 次交互`),
                              sessionData.llmMs > 0
                                ? h(
                                    'span',
                                    { className: 'dsh-tp-item-stats' },
                                    `模型运行: ${(sessionData.llmMs / 60000).toFixed(1)} 分钟${sessionData.ttftSteps > 0 ? ` (首字平均 ${(sessionData.ttftMs / sessionData.ttftSteps / 1000).toFixed(1)}s)` : ''}`,
                                  )
                                : null,
                            ]),
                          ])
                        : null,
                    ]
                  : globalData === null
                  ? [
                      // Friendly hint if backend route is not reachable yet
                      h(
                        'div',
                        {
                          key: 'loading-state',
                          style: {
                            padding: '36px 20px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            textAlign: 'center',
                            gap: '12px',
                          },
                        },
                        [
                          h('div', { key: 'i', style: { fontSize: '32px' } }, '📊'),
                          h(
                            'div',
                            { key: 't', style: { fontSize: '13.5px', fontWeight: 650 } },
                            '全局历史统计服务加载中',
                          ),
                          h(
                            'div',
                            {
                              key: 'd',
                              style: {
                                fontSize: '11.5px',
                                color: 'var(--dsw-alias-label-secondary, #8e8e93)',
                                maxWidth: '380px',
                                lineHeight: 1.6,
                              },
                            },
                            '由于插件新增了后台全局聚合路由，需要完全退出 DeepSeek Harness 客户端并重新启动软件才能生效（仅按 Ctrl+R 只会重载界面，不会加载后端新增路由）。',
                          ),
                          h(
                            'button',
                            {
                              key: 'retry',
                              type: 'button',
                              className: 'dsh-tp-btn',
                              style: { marginTop: '8px', padding: '5px 16px' },
                              onClick: onRefreshGlobal,
                            },
                            '重试刷新连接',
                          ),
                        ],
                      ),
                    ]
                  : [
                      // Global Subtabs
                      h('div', { key: 'subtabs', className: 'dsh-tp-subtabs' }, [
                        h(
                          'button',
                          {
                            key: 'st-today',
                            type: 'button',
                            className: `dsh-tp-subtab ${globalRange === 'today' ? 'dsh-tp-subtab-active' : ''}`,
                            onClick: () => setGlobalRange('today'),
                          },
                          '今日',
                        ),
                        h(
                          'button',
                          {
                            key: 'st-week',
                            type: 'button',
                            className: `dsh-tp-subtab ${globalRange === 'week' ? 'dsh-tp-subtab-active' : ''}`,
                            onClick: () => setGlobalRange('week'),
                          },
                          '最近 7 天 (周)',
                        ),
                        h(
                          'button',
                          {
                            key: 'st-month',
                            type: 'button',
                            className: `dsh-tp-subtab ${globalRange === 'month' ? 'dsh-tp-subtab-active' : ''}`,
                            onClick: () => setGlobalRange('month'),
                          },
                          '最近 30 天 (月)',
                        ),
                      ]),

                      // Global Grid
                      h('div', { key: 'g-grid', className: 'dsh-tp-grid' }, [
                        h('div', { key: 'gc1', className: 'dsh-tp-card' }, [
                          h('span', { className: 'dsh-tp-card-title' }, `${rangeLabel}总消耗`),
                          h('span', { className: 'dsh-tp-card-val' }, formatTokens(currentRangeData.total)),
                          h(
                            'span',
                            { className: 'dsh-tp-card-sub' },
                            `${currentRangeData.total.toLocaleString()} tokens`,
                          ),
                        ]),
                        h('div', { key: 'gc2', className: 'dsh-tp-card' }, [
                          h('span', { className: 'dsh-tp-card-title' }, '补全输出 (Output)'),
                          h(
                            'span',
                            { className: 'dsh-tp-card-val', style: { color: '#3b82f6' } },
                            formatTokens(currentRangeData.output),
                          ),
                          h(
                            'span',
                            { className: 'dsh-tp-card-sub' },
                            `${currentRangeData.output.toLocaleString()} tokens`,
                          ),
                        ]),
                        h('div', { key: 'gc3', className: 'dsh-tp-card' }, [
                          h('span', { className: 'dsh-tp-card-title' }, '缓存命中率 (Cache Hit)'),
                          h(
                            'span',
                            { className: 'dsh-tp-card-val', style: { color: '#10b981' } },
                            `${currentRangeData.cachePct.toFixed(1)}%`,
                          ),
                          h(
                            'span',
                            { className: 'dsh-tp-card-sub' },
                            `读取 ${formatTokens(currentRangeData.cacheRead)} tokens`,
                          ),
                        ]),
                        h('div', { key: 'gc4', className: 'dsh-tp-card' }, [
                          h('span', { className: 'dsh-tp-card-title' }, '未缓存输入与调用'),
                          h('span', { className: 'dsh-tp-card-val' }, formatTokens(currentRangeData.input)),
                          h(
                            'span',
                            { className: 'dsh-tp-card-sub' },
                            `共 ${currentRangeData.calls.toLocaleString()} 次交互`,
                          ),
                        ]),
                      ]),

                      // Daily Breakdown Table
                      globalData && Array.isArray(globalData.days) && globalData.days.length > 0
                        ? h('div', { key: 'daily-sec', className: 'dsh-tp-sec' }, [
                            h(
                              'span',
                              { className: 'dsh-tp-sec-title' },
                              `📅 每日走势明细 (${globalRange === 'today' ? '今日' : globalRange === 'week' ? '近 7 天' : '近 30 天'})`,
                            ),
                            h('div', { className: 'dsh-tp-table-wrap' }, [
                              h('table', { className: 'dsh-tp-table' }, [
                                h('thead', null, [
                                  h('tr', null, [
                                    h('th', null, '日期'),
                                    h('th', null, '输出 (生成)'),
                                    h('th', null, '未缓存输入'),
                                    h('th', null, '缓存读取'),
                                    h('th', null, '缓存率'),
                                  ]),
                                ]),
                                h(
                                  'tbody',
                                  null,
                                  globalData.days
                                    .slice(0, globalRange === 'today' ? 1 : globalRange === 'week' ? 7 : 30)
                                    .map((d) =>
                                      h('tr', { key: d.date }, [
                                        h('td', { style: { fontWeight: 550 } }, d.date),
                                        h('td', { style: { color: '#3b82f6' } }, formatTokens(d.output)),
                                        h('td', null, formatTokens(d.input)),
                                        h('td', null, formatTokens(d.cacheRead)),
                                        h(
                                          'td',
                                          { style: { color: d.cachePct >= 80 ? '#10b981' : 'inherit' } },
                                          `${d.cachePct.toFixed(1)}%`,
                                        ),
                                      ]),
                                    ),
                                ),
                              ]),
                            ]),
                          ])
                        : null,

                      // Top Sessions
                      globalData && Array.isArray(globalData.topSessions) && globalData.topSessions.length > 0
                        ? h('div', { key: 'top-sec', className: 'dsh-tp-sec' }, [
                            h('span', { className: 'dsh-tp-sec-title' }, '🏆 活跃会话 TOP 5'),
                            h(
                              'div',
                              { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
                              globalData.topSessions.slice(0, 5).map((s) =>
                                h('div', { key: s.id, className: 'dsh-tp-item' }, [
                                  h('span', { className: 'dsh-tp-item-title', title: s.title }, s.title),
                                  h(
                                    'span',
                                    { className: 'dsh-tp-item-stats' },
                                    `输出 ${formatTokens(s.output)} · 缓存 ${s.cachePct.toFixed(0)}%`,
                                  ),
                                ]),
                              ),
                            ),
                          ])
                        : null,
                    ],
              ),

              // Footer
              h('div', { key: 'footer', className: 'dsh-tp-footer' }, [
                h(
                  'button',
                  {
                    key: 'copy-btn',
                    type: 'button',
                    className: 'dsh-tp-btn-copy',
                    onClick: handleCopy,
                  },
                  copied ? '✓ 已复制报告到剪贴板' : '📋 复制当前统计报告',
                ),
                h(
                  'button',
                  {
                    key: 'done-btn',
                    type: 'button',
                    className: 'dsh-tp-btn-done',
                    onClick: onClose,
                  },
                  '完成',
                ),
              ]),
            ],
          ),
        ])
      }

      function TokenPillAction(props) {
        const useProjection = typeof props.useProjection === 'function' ? props.useProjection : null
        const rawUsage = useProjection ? useProjection('tokenUsage') : null
        const rawStats = useProjection ? useProjection('sessionStats') : null

        const tokenUsage = rawUsage && rawUsage.val ? rawUsage.val : rawUsage
        const sessionStats = rawStats && rawStats.val ? rawStats.val : rawStats

        const [modalOpen, setModalOpen] = React.useState(false)
        const [globalData, setGlobalData] = React.useState(null)

        const fetchGlobalStats = React.useCallback(() => {
          const url =
            typeof document !== 'undefined'
              ? new URL(STATS_ROUTE, document.baseURI).href
              : STATS_ROUTE
          fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d && d.ok) setGlobalData(d)
            })
            .catch(() => {})
        }, [])

        React.useEffect(() => {
          fetchGlobalStats()
        }, [fetchGlobalStats])

        const totals = tokenUsage?.totals
        const uncached = Number(totals?.uncachedInputTokens || 0)
        const output = Number(totals?.outputTokens || 0)
        const cacheRead = Number(totals?.cacheReadTokens || 0)
        const cacheWrite = Number(totals?.cacheWriteTokens || 0)
        const totalInput = uncached + cacheRead
        const totalTokens = totalInput + output
        const cachePct = totalInput > 0 ? (cacheRead / totalInput) * 100 : 0

        const last = tokenUsage?.last
        const lastTurn = last?.turn
        const lastStep = last?.step
        const lastBuckets = last?.buckets
        const lastUncached = Number(lastBuckets?.uncachedInputTokens || 0)
        const lastOutput = Number(lastBuckets?.outputTokens || 0)
        const lastCacheRead = Number(lastBuckets?.cacheReadTokens || 0)
        const lastTotalInput = lastUncached + lastCacheRead
        const lastCachePct = lastTotalInput > 0 ? (lastCacheRead / lastTotalInput) * 100 : 0

        const turns = sessionStats?.turns || 0
        const steps = sessionStats?.steps || 0
        const llmMs = sessionStats?.llmMs || 0
        const ttftMs = sessionStats?.ttftMs || 0
        const ttftSteps = sessionStats?.ttftSteps || 0

        const sessionData = {
          totalTokens,
          output,
          uncached,
          cacheRead,
          cacheWrite,
          cachePct,
          lastBuckets,
          lastTurn,
          lastStep,
          lastOutput,
          lastUncached,
          lastCacheRead,
          lastCachePct,
          turns,
          steps,
          llmMs,
          ttftMs,
          ttftSteps,
        }

        const handleOpenModal = (e) => {
          e.stopPropagation()
          fetchGlobalStats()
          setModalOpen(true)
        }

        // Blank session or home page: show clean subtle "⚡ 0" in input, hide in header
        if (totalTokens <= 0) {
          if (props.placement === 'header') return null
          return h('span', { className: 'dsh-tp-group' }, [
            h(
              'button',
              {
                key: 'btn',
                type: 'button',
                className: 'dsh-tp-btn dsh-tp-btn-empty',
                title: '📊 Token 用量统计 (点击查看详细面板)\n─────────────────────────\n当前会话暂无 Token 消耗\n点击可查看周/月度总消耗与历史明细',
                'aria-label': 'Token 用量: 0',
                onClick: handleOpenModal,
              },
              [
                h('span', { key: 'icon', className: 'dsh-tp-icon dsh-tp-icon-dim' }, '⚡'),
                h('span', { key: 'zero', className: 'dsh-tp-main dsh-tp-dim' }, '0'),
              ],
            ),
            h(TokenStatsModal, {
              key: 'modal',
              isOpen: modalOpen,
              onClose: () => setModalOpen(false),
              sessionData,
              globalData,
              onRefreshGlobal: fetchGlobalStats,
            }),
          ])
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

        const tooltip = `📊 Token 用量统计 (点击查看周/月分析面板)\n总消耗: ${formatTokens(totalTokens)} tokens\n补全输出: ${formatTokens(output)} | 缓存: ${cachePct.toFixed(1)}%`

        return h('span', { className: 'dsh-tp-group' }, [
          h(
            'button',
            {
              key: 'btn',
              type: 'button',
              className: 'dsh-tp-btn',
              title: tooltip,
              'aria-label': tooltip,
              onClick: handleOpenModal,
            },
            children,
          ),
          h(TokenStatsModal, {
            key: 'modal',
            isOpen: modalOpen,
            onClose: () => setModalOpen(false),
            sessionData,
            globalData,
            onRefreshGlobal: fetchGlobalStats,
          }),
        ])
      }

      function apply(ctx) {
        ensureStyle()
        if (!ctx.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return

        // 1. Session header utilities row (top-right of open conversation)
        ctx.effect(() => {
          return ctx.slots.inject('conversation.session.header.utilities', () => {
            return ctx.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'token-pill-header',
                order: -5,
                label: () => 'Token 用量',
              },
              (props) => h(TokenPillAction, { ...props, placement: 'header' }),
            )
          })
        }, 'dsh-token-pill: header token pill')

        // 2. Composer input right toolbar (next to model selector & quota chip)
        ctx.effect(() => {
          return ctx.slots.inject('conversation.input.right', () => {
            return ctx.slots.register(
              {
                name: 'conversation.input.right',
                id: 'token-pill-input',
                order: 85,
                inject: (sessionId) => ({ sessionId }),
              },
              (props) => h(TokenPillAction, { ...props, placement: 'input' }),
            )
          })
        }, 'dsh-token-pill: composer token pill')
      }

      exports.inject = ['slots']
      exports.apply = apply
      return module.exports
    },
  })
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null)
