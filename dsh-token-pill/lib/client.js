// dsh-token-pill — browser half.
//
// A minimal pill in the composer toolbar + session header:
//   [ ⚡ 38.2k · 缓 96% ]
// Clicking it opens the Token 用量分析 panel:
//   - 当前会话：总量构成（输出 / 未缓存输入 / 缓存读取）、命中率、最近一轮、交互效率
//   - 全局趋势：今日 / 近 7 天 / 近 30 天、每日走势条形图、活跃会话 TOP 5
//   - 一键复制当前视图为文本报告

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

      let reactDom = null
      try {
        reactDom = require('react-dom')
      } catch {
        reactDom = null
      }
      const createPortal = reactDom && typeof reactDom.createPortal === 'function' ? reactDom.createPortal : null

      function portalToBody(node) {
        if (createPortal === null) return node
        if (typeof document === 'undefined' || !document.body) return node
        try {
          return createPortal(node, document.body)
        } catch {
          return node
        }
      }

      const STATS_ROUTE = '/__dsh-token-pill/stats'
      const STYLE_ID = 'dsh-token-pill-style'

      const C_OUT = 'var(--dsh-tp-out)'
      const C_IN = 'var(--dsh-tp-in)'
      const C_CACHE = 'var(--dsh-tp-cache)'

      function parseCssColor(text) {
        const raw = String(text === null || text === undefined ? '' : text).trim()
        if (!raw) return null
        let m = raw.match(/^#([0-9a-f]{3,8})$/i)
        if (m) {
          const hex = m[1]
          if (hex.length === 3 || hex.length === 4) {
            return [
              parseInt(hex.charAt(0) + hex.charAt(0), 16),
              parseInt(hex.charAt(1) + hex.charAt(1), 16),
              parseInt(hex.charAt(2) + hex.charAt(2), 16),
            ]
          }
          if (hex.length === 6 || hex.length === 8) {
            return [
              parseInt(hex.slice(0, 2), 16),
              parseInt(hex.slice(2, 4), 16),
              parseInt(hex.slice(4, 6), 16),
            ]
          }
          return null
        }
        m = raw.match(/^rgba?\(([^)]+)\)$/i)
        if (m) {
          const nums = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
          if (nums.length >= 3 && nums.slice(0, 3).every(Number.isFinite)) return [nums[0], nums[1], nums[2]]
        }
        return null
      }

      function detectHostTheme() {
        try {
          if (typeof document !== 'undefined' && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            const el = document.documentElement || document.body
            if (el) {
              const styles = window.getComputedStyle(el)
              const probe = styles && typeof styles.getPropertyValue === 'function' ? styles.getPropertyValue('--dsw-alias-bg-base') : ''
              const rgb = parseCssColor(probe)
              if (rgb) {
                const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
                return lum > 0.5 ? 'light' : 'dark'
              }
            }
          }
        } catch {}
        try {
          if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
          }
        } catch {}
        return 'light'
      }

      function useHostTheme() {
        const [theme, setTheme] = React.useState(detectHostTheme)
        React.useEffect(() => {
          const sync = () => setTheme((prev) => {
            const next = detectHostTheme()
            return next === prev ? prev : next
          })
          sync()
          let observer = null
          let media = null
          const attrs = ['class', 'style', 'data-theme', 'data-color-scheme']
          try {
            if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
              observer = new MutationObserver(sync)
              if (document.documentElement) observer.observe(document.documentElement, { attributes: true, attributeFilter: attrs })
              if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: attrs })
            }
          } catch {
            observer = null
          }
          try {
            if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
              media = window.matchMedia('(prefers-color-scheme: dark)')
              if (media && typeof media.addEventListener === 'function') media.addEventListener('change', sync)
            }
          } catch {
            media = null
          }
          return () => {
            try { if (observer) observer.disconnect() } catch {}
            try { if (media && typeof media.removeEventListener === 'function') media.removeEventListener('change', sync) } catch {}
          }
        }, [])
        return theme
      }

      const STYLE = `
        /* ===== 主题令牌 ===== */
        .dsh-tp-scope {
          --dsh-tp-surface: var(--dsw-alias-bg-overlay, #ffffff);
          --dsh-tp-surface-2: var(--dsw-alias-bg-layer-1, #f8f9fb);
          --dsh-tp-surface-3: var(--dsw-alias-bg-layer-2, #edeff3);
          --dsh-tp-border: var(--dsw-alias-border-l1, rgba(16, 24, 40, 0.08));
          --dsh-tp-border-strong: var(--dsw-alias-border-l2, rgba(16, 24, 40, 0.16));
          --dsh-tp-fg: var(--dsw-alias-label-primary, #111827);
          --dsh-tp-fg-dim: var(--dsw-alias-label-secondary, #6b7280);
          --dsh-tp-brand: var(--dsw-alias-brand-primary, #2563eb);
          --dsh-tp-track: rgba(16, 24, 40, 0.08);
          --dsh-tp-hover: rgba(16, 24, 40, 0.05);
          --dsh-tp-out: #2563eb;
          --dsh-tp-in: #d97706;
          --dsh-tp-cache: #059669;
          --dsh-tp-out-soft: rgba(37, 99, 235, 0.12);
          --dsh-tp-out-weak: rgba(37, 99, 235, 0.5);
          --dsh-tp-out-tint: rgba(37, 99, 235, 0.06);
          --dsh-tp-scrim: rgba(15, 23, 42, 0.46);
          --dsh-tp-shadow: 0 24px 48px -12px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.08);
          --dsh-tp-on-brand: #ffffff;
          color-scheme: light;
        }
        .dsh-tp-scope[data-dsh-tp-theme='dark'] {
          --dsh-tp-surface: var(--dsw-alias-bg-overlay, #1c1d22);
          --dsh-tp-surface-2: var(--dsw-alias-bg-layer-1, #25272e);
          --dsh-tp-surface-3: var(--dsw-alias-bg-layer-2, #2f323b);
          --dsh-tp-border: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.09));
          --dsh-tp-border-strong: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.16));
          --dsh-tp-fg: var(--dsw-alias-label-primary, #f3f4f6);
          --dsh-tp-fg-dim: var(--dsw-alias-label-secondary, #9ca3af);
          --dsh-tp-brand: var(--dsw-alias-brand-primary, #60a5fa);
          --dsh-tp-track: rgba(255, 255, 255, 0.12);
          --dsh-tp-hover: rgba(255, 255, 255, 0.06);
          --dsh-tp-out: #60a5fa;
          --dsh-tp-in: #fbbf24;
          --dsh-tp-cache: #34d399;
          --dsh-tp-out-soft: rgba(96, 165, 250, 0.18);
          --dsh-tp-out-weak: rgba(96, 165, 250, 0.55);
          --dsh-tp-out-tint: rgba(96, 165, 250, 0.1);
          --dsh-tp-scrim: rgba(0, 0, 0, 0.65);
          --dsh-tp-shadow: 0 24px 50px -12px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08);
          --dsh-tp-on-brand: #0f172a;
          color-scheme: dark;
        }

        /* ===== 胶囊按钮 ===== */
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
          padding: 0 9px;
          border-radius: 9999px;
          border: 1px solid var(--dsh-tp-border);
          background: var(--dsh-tp-hover);
          color: var(--dsh-tp-fg);
          font: inherit;
          font-size: 11px;
          font-weight: 550;
          line-height: 1;
          cursor: pointer;
          user-select: none;
          transition: background 0.15s ease, border-color 0.15s ease, transform 0.12s ease;
          white-space: nowrap;
          outline: none;
          box-sizing: border-box;
        }
        .dsh-tp-btn:hover {
          background: var(--dsh-tp-track);
          border-color: var(--dsh-tp-border-strong);
          transform: translateY(-0.5px);
        }
        .dsh-tp-btn:active { transform: translateY(0); }
        .dsh-tp-btn-empty { opacity: 0.75; }
        .dsh-tp-btn-empty:hover { opacity: 1; }
        .dsh-tp-icon {
          font-size: 11px;
          line-height: 1;
          color: var(--dsh-tp-brand);
        }
        .dsh-tp-icon-dim { color: var(--dsh-tp-fg-dim); }
        .dsh-tp-main {
          font-variant-numeric: tabular-nums;
          font-weight: 650;
          color: var(--dsh-tp-fg);
        }
        .dsh-tp-dim { font-weight: 550; color: var(--dsh-tp-fg-dim); }
        .dsh-tp-cache {
          font-variant-numeric: tabular-nums;
          color: var(--dsh-tp-cache);
          font-size: 10.5px;
          font-weight: 600;
        }

        /* ===== 弹窗骨架 ===== */
        .dsh-tp-overlay {
          position: fixed;
          inset: 0;
          z-index: 2147483000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px 16px;
          background: var(--dsh-tp-scrim);
          box-sizing: border-box;
          pointer-events: auto;
          backdrop-filter: blur(2px);
          animation: dsh-tp-fade 0.15s ease-out;
        }
        .dsh-tp-dialog {
          width: min(560px, 95vw);
          max-height: min(82vh, 660px);
          min-height: 0;
          border-radius: 12px;
          background: var(--dsh-tp-surface);
          border: 1px solid var(--dsh-tp-border-strong);
          box-shadow: var(--dsh-tp-shadow);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          color: var(--dsh-tp-fg);
          font: inherit;
          font-size: 12.5px;
          box-sizing: border-box;
          animation: dsh-tp-pop 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes dsh-tp-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsh-tp-pop {
          from { opacity: 0; transform: scale(0.97) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* ===== 头部 ===== */
        .dsh-tp-head {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px 10px;
          flex: 0 0 auto;
        }
        .dsh-tp-badge {
          width: 26px;
          height: 26px;
          flex: 0 0 auto;
          border-radius: 7px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          background: var(--dsh-tp-out-soft);
          color: var(--dsh-tp-brand);
        }
        .dsh-tp-head-text {
          display: flex;
          align-items: baseline;
          gap: 8px;
          min-width: 0;
          flex: 1 1 auto;
          overflow: hidden;
        }
        .dsh-tp-head-title {
          font-size: 13.5px;
          font-weight: 700;
          letter-spacing: 0.01em;
          color: var(--dsh-tp-fg);
          white-space: nowrap;
        }
        .dsh-tp-head-sub {
          font-size: 11px;
          color: var(--dsh-tp-fg-dim);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          padding: 1px 6px;
          border-radius: 4px;
          background: var(--dsh-tp-hover);
        }
        .dsh-tp-icon-btn {
          width: 26px;
          height: 26px;
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          border: 1px solid transparent;
          border-radius: 6px;
          background: transparent;
          color: var(--dsh-tp-fg-dim);
          font-size: 13px;
          cursor: pointer;
          transition: background 0.14s, color 0.14s;
        }
        .dsh-tp-icon-btn:hover {
          background: var(--dsh-tp-hover);
          color: var(--dsh-tp-fg);
        }

        /* ===== 顶部导航栏（标签页与筛选） ===== */
        .dsh-tp-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 0 16px 10px;
          flex: 0 0 auto;
          border-bottom: 1px solid var(--dsh-tp-border);
        }
        .dsh-tp-seg {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 2.5px;
          border-radius: 7px;
          background: var(--dsh-tp-surface-3);
          box-sizing: border-box;
        }
        .dsh-tp-seg-item {
          padding: 3.5px 11px;
          border: 0;
          border-radius: 5px;
          background: transparent;
          color: var(--dsh-tp-fg-dim);
          font: inherit;
          font-size: 11.5px;
          font-weight: 600;
          line-height: 1.35;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.14s, color 0.14s, box-shadow 0.14s;
        }
        .dsh-tp-seg-item:hover { color: var(--dsh-tp-fg); }
        .dsh-tp-seg-item-on {
          background: var(--dsh-tp-surface);
          color: var(--dsh-tp-fg);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
        }

        /* ===== 内容主体 ===== */
        .dsh-tp-body {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .dsh-tp-body::-webkit-scrollbar { width: 6px; }
        .dsh-tp-body::-webkit-scrollbar-thumb {
          background: var(--dsh-tp-track);
          border-radius: 3px;
        }

        /* ===== 主消耗 Hero 卡片 ===== */
        .dsh-tp-hero {
          padding: 13px 14px;
          border-radius: 10px;
          background: var(--dsh-tp-surface-2);
          border: 1px solid var(--dsh-tp-border);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .dsh-tp-hero-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
        }
        .dsh-tp-hero-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: var(--dsh-tp-fg-dim);
        }
        .dsh-tp-hero-exact {
          font-size: 11px;
          color: var(--dsh-tp-fg-dim);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .dsh-tp-hero-num {
          display: flex;
          align-items: baseline;
          gap: 6px;
        }
        .dsh-tp-hero-val {
          font-size: 28px;
          font-weight: 750;
          line-height: 1.1;
          letter-spacing: -0.01em;
          font-variant-numeric: tabular-nums;
          color: var(--dsh-tp-fg);
        }
        .dsh-tp-hero-unit {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--dsh-tp-fg-dim);
        }

        /* 构成进度条 */
        .dsh-tp-comp-track {
          display: flex;
          width: 100%;
          height: 8px;
          border-radius: 4px;
          overflow: hidden;
          background: var(--dsh-tp-track);
        }
        .dsh-tp-comp-seg { height: 100%; transition: width 0.28s ease; }
        .dsh-tp-comp-seg + .dsh-tp-comp-seg { box-shadow: inset 1px 0 0 rgba(0, 0, 0, 0.15); }
        .dsh-tp-legend {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .dsh-tp-legend-item {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: var(--dsh-tp-fg-dim);
          line-height: 1.4;
        }
        .dsh-tp-dot {
          width: 7px;
          height: 7px;
          flex: 0 0 auto;
          border-radius: 2px;
        }
        .dsh-tp-legend-val {
          color: var(--dsh-tp-fg);
          font-weight: 650;
          font-variant-numeric: tabular-nums;
        }
        .dsh-tp-legend-pct {
          color: var(--dsh-tp-fg-dim);
          font-weight: 550;
          font-variant-numeric: tabular-nums;
        }

        /* ===== 核心指标三列卡片（无冗余） ===== */
        .dsh-tp-grid-3 {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .dsh-tp-tile {
          padding: 10px 12px;
          border-radius: 9px;
          background: var(--dsh-tp-surface-2);
          border: 1px solid var(--dsh-tp-border);
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .dsh-tp-tile-label {
          font-size: 10.5px;
          font-weight: 600;
          color: var(--dsh-tp-fg-dim);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dsh-tp-tile-val {
          font-size: 16px;
          font-weight: 700;
          line-height: 1.25;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          color: var(--dsh-tp-fg);
        }
        .dsh-tp-tile-sub {
          font-size: 10.5px;
          color: var(--dsh-tp-fg-dim);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ===== 最近一轮高光条 ===== */
        .dsh-tp-last-card {
          padding: 9px 12px;
          border-radius: 8px;
          background: var(--dsh-tp-surface-2);
          border: 1px solid var(--dsh-tp-border);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .dsh-tp-last-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 11px;
          color: var(--dsh-tp-fg-dim);
        }
        .dsh-tp-last-title {
          font-weight: 650;
          color: var(--dsh-tp-fg);
        }
        .dsh-tp-last-chips {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .dsh-tp-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 7px;
          border-radius: 5px;
          background: var(--dsh-tp-surface-3);
          font-size: 10.5px;
          font-variant-numeric: tabular-nums;
          color: var(--dsh-tp-fg);
        }
        .dsh-tp-chip-dim { color: var(--dsh-tp-fg-dim); }

        /* ===== 分区（每日走势 / 排行） ===== */
        .dsh-tp-sec { display: flex; flex-direction: column; gap: 7px; }
        .dsh-tp-sec-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .dsh-tp-sec-title {
          font-size: 11.5px;
          font-weight: 650;
          letter-spacing: 0.01em;
          color: var(--dsh-tp-fg);
        }
        .dsh-tp-sec-hint {
          font-size: 10.5px;
          color: var(--dsh-tp-fg-dim);
          font-variant-numeric: tabular-nums;
        }

        /* 每日走势条形表 */
        .dsh-tp-trend {
          display: flex;
          flex-direction: column;
          gap: 2px;
          max-height: 200px;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding-right: 2px;
        }
        .dsh-tp-trend-row {
          display: grid;
          grid-template-columns: 82px minmax(0, 1fr) 68px 46px;
          align-items: center;
          gap: 8px;
          padding: 4px 6px;
          border-radius: 5px;
          transition: background 0.12s;
        }
        .dsh-tp-trend-row:hover { background: var(--dsh-tp-hover); }
        .dsh-tp-trend-row-today { background: var(--dsh-tp-out-tint); }
        .dsh-tp-trend-date {
          font-size: 11px;
          color: var(--dsh-tp-fg-dim);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .dsh-tp-trend-date-today {
          color: var(--dsh-tp-brand);
          font-weight: 700;
        }
        .dsh-tp-track {
          position: relative;
          height: 6px;
          border-radius: 3px;
          background: var(--dsh-tp-track);
          overflow: hidden;
        }
        .dsh-tp-track-fill {
          position: absolute;
          inset: 0 auto 0 0;
          border-radius: 3px;
          min-width: 2px;
          transition: width 0.3s ease;
        }
        .dsh-tp-trend-total {
          font-size: 11px;
          font-weight: 650;
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          color: var(--dsh-tp-fg);
        }
        .dsh-tp-trend-cache {
          font-size: 10.5px;
          text-align: right;
          font-variant-numeric: tabular-nums;
          color: var(--dsh-tp-fg-dim);
          white-space: nowrap;
        }

        /* 会话排行 */
        .dsh-tp-rank { display: flex; flex-direction: column; gap: 2px; }
        .dsh-tp-rank-row {
          display: grid;
          grid-template-columns: 16px minmax(0, 1fr) 110px;
          align-items: center;
          gap: 8px;
          padding: 5px 6px;
          border-radius: 5px;
          transition: background 0.12s;
        }
        .dsh-tp-rank-row:hover { background: var(--dsh-tp-hover); }
        .dsh-tp-rank-no {
          font-size: 10.5px;
          font-weight: 700;
          text-align: center;
          color: var(--dsh-tp-fg-dim);
          font-variant-numeric: tabular-nums;
        }
        .dsh-tp-rank-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .dsh-tp-rank-title {
          font-size: 11.5px;
          font-weight: 550;
          color: var(--dsh-tp-fg);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dsh-tp-rank-track {
          position: relative;
          height: 4px;
          border-radius: 2px;
          background: var(--dsh-tp-track);
          overflow: hidden;
        }
        .dsh-tp-rank-fill {
          position: absolute;
          inset: 0 auto 0 0;
          border-radius: 2px;
          background: linear-gradient(90deg, var(--dsh-tp-out), var(--dsh-tp-out-weak));
        }
        .dsh-tp-rank-num {
          display: flex;
          flex-direction: column;
          gap: 1px;
          text-align: right;
        }
        .dsh-tp-rank-total {
          font-size: 11.5px;
          font-weight: 650;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          color: var(--dsh-tp-fg);
        }
        .dsh-tp-rank-sub {
          font-size: 10px;
          color: var(--dsh-tp-fg-dim);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        /* ===== 空态 ===== */
        .dsh-tp-empty {
          padding: 36px 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 10px;
        }
        .dsh-tp-empty-icon { font-size: 28px; line-height: 1; color: var(--dsh-tp-brand); }
        .dsh-tp-empty-title { font-size: 13px; font-weight: 700; color: var(--dsh-tp-fg); }
        .dsh-tp-empty-desc {
          font-size: 11.5px;
          line-height: 1.6;
          max-width: 380px;
          color: var(--dsh-tp-fg-dim);
        }

        /* ===== 底部操作栏 ===== */
        .dsh-tp-foot {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 16px;
          border-top: 1px solid var(--dsh-tp-border);
          background: var(--dsh-tp-surface-2);
        }
        .dsh-tp-foot-note {
          font-size: 10.5px;
          color: var(--dsh-tp-fg-dim);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dsh-tp-foot-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
        .dsh-tp-btn-ghost {
          padding: 5px 12px;
          border-radius: 6px;
          border: 1px solid var(--dsh-tp-border-strong);
          background: var(--dsh-tp-surface);
          color: var(--dsh-tp-fg);
          font: inherit;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
          transition: background 0.14s, border-color 0.14s;
        }
        .dsh-tp-btn-ghost:hover {
          background: var(--dsh-tp-hover);
        }
        .dsh-tp-btn-primary {
          padding: 5px 16px;
          border-radius: 6px;
          border: 1px solid transparent;
          background: var(--dsh-tp-brand);
          color: var(--dsh-tp-on-brand);
          font: inherit;
          font-size: 11.5px;
          font-weight: 650;
          cursor: pointer;
          white-space: nowrap;
          transition: filter 0.14s;
        }
        .dsh-tp-btn-primary:hover { filter: brightness(1.08); }
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

      // ---------- 格式化工具 ----------

      function formatTokens(num) {
        const n = Number(num) || 0
        if (n <= 0) return '0'
        if (n >= 1e9) return trimZero((n / 1e9).toFixed(2)) + 'B'
        if (n >= 1e6) return trimZero((n / 1e6).toFixed(2)) + 'M'
        if (n >= 1e3) return trimZero((n / 1e3).toFixed(1)) + 'k'
        return String(Math.round(n))
      }

      function trimZero(text) {
        return text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
      }

      function formatInt(num) {
        const n = Number(num) || 0
        return n.toLocaleString('en-US')
      }

      function pctOf(part, whole) {
        const p = Number(part) || 0
        const w = Number(whole) || 0
        return w > 0 ? (p / w) * 100 : 0
      }

      function pctText(value, digits) {
        const d = typeof digits === 'number' ? digits : 1
        const v = Number(value) || 0
        if (v > 0 && v < 100 && Number(v.toFixed(d)) >= 100) return '99+%'
        return v.toFixed(d) + '%'
      }

      function formatDuration(ms) {
        const v = Number(ms) || 0
        if (v <= 0) return '—'
        if (v < 1000) return Math.round(v) + 'ms'
        if (v < 60000) return (v / 1000).toFixed(1) + 's'
        const mins = v / 60000
        if (mins < 60) return mins.toFixed(1) + ' 分'
        return (mins / 60).toFixed(1) + ' 时'
      }

      const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

      function dayParts(dateStr) {
        const md = String(dateStr || '').slice(5)
        let wd = ''
        try {
          const d = new Date(String(dateStr) + 'T00:00:00')
          if (!Number.isNaN(d.getTime())) wd = WEEKDAYS[d.getDay()]
        } catch {}
        return { md: md || String(dateStr || ''), wd }
      }

      function todayString() {
        try {
          return new Date().toISOString().slice(0, 10)
        } catch {
          return ''
        }
      }

      // 提取会话 Token 总量（自适应所有 DSH 投影版本）
      function extractTokenTotals(rawUsage, rawMeasurement) {
        if (!rawUsage && !rawMeasurement) return { uncached: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        const u = rawUsage && rawUsage.val ? rawUsage.val : rawUsage
        const t = (u && (u.totals || (u.uncachedInputTokens !== undefined ? u : null) || (u.val && u.val.totals))) || null

        let uncached = Number(t && t.uncachedInputTokens !== undefined ? t.uncachedInputTokens : 0)
        let output = Number(t && t.outputTokens !== undefined ? t.outputTokens : 0)
        let cacheRead = Number(t && t.cacheReadTokens !== undefined ? t.cacheReadTokens : 0)
        let cacheWrite = Number(t && t.cacheWriteTokens !== undefined ? t.cacheWriteTokens : 0)

        // 兜底：若仍为 0 则尝试读取 tokenMeasurement anchor
        if (uncached + output + cacheRead === 0 && rawMeasurement) {
          const m = rawMeasurement.val || rawMeasurement
          const usage = (m && m.anchor && m.anchor.usage) || (m && m.usage)
          if (usage) {
            uncached = Number(usage.uncachedInputTokens || usage.input_tokens || 0)
            output = Number(usage.outputTokens || usage.output_tokens || 0)
            cacheRead = Number(usage.cacheReadTokens || usage.cache_read_input_tokens || 0)
            cacheWrite = Number(usage.cacheWriteTokens || usage.cache_creation_input_tokens || 0)
          }
        }

        return { uncached, output, cacheRead, cacheWrite }
      }

      // 提取最新一轮开销
      function extractLastBuckets(rawUsage) {
        if (!rawUsage) return null
        const u = rawUsage.val || rawUsage
        const last = u && (u.last || (u.val && u.val.last))
        if (!last) return null
        const b = last.buckets || last
        const uncached = Number(b.uncachedInputTokens || 0)
        const output = Number(b.outputTokens || 0)
        const cacheRead = Number(b.cacheReadTokens || 0)
        const cacheWrite = Number(b.cacheWriteTokens || 0)
        if (uncached + output + cacheRead === 0) return null
        return {
          turn: last.turn,
          step: last.step,
          uncached,
          output,
          cacheRead,
          cacheWrite,
          total: uncached + output + cacheRead,
          cachePct: pctOf(cacheRead, uncached + cacheRead),
        }
      }

      // ---------- 视图组件 ----------

      function CompositionBar({ output, input, cacheRead }) {
        const total = output + input + cacheRead
        const parts = [
          { key: 'c', label: '缓存读取', value: cacheRead, color: C_CACHE },
          { key: 'i', label: '未缓存输入', value: input, color: C_IN },
          { key: 'o', label: '补全输出', value: output, color: C_OUT },
        ]
        return h('div', { className: 'dsh-tp-comp' }, [
          h(
            'div',
            { key: 'track', className: 'dsh-tp-comp-track' },
            total > 0
              ? parts
                  .filter((p) => p.value > 0)
                  .map((p) =>
                    h('div', {
                      key: p.key,
                      className: 'dsh-tp-comp-seg',
                      style: { width: pctOf(p.value, total) + '%', background: p.color },
                      title: p.label + ' ' + formatInt(p.value) + ' (' + pctText(pctOf(p.value, total)) + ')',
                    }),
                  )
              : null,
          ),
          h(
            'div',
            { key: 'legend', className: 'dsh-tp-legend', style: { marginTop: '8px' } },
            parts.map((p) =>
              h('span', { key: p.key, className: 'dsh-tp-legend-item' }, [
                h('i', { key: 'd', className: 'dsh-tp-dot', style: { background: p.color } }),
                h('span', { key: 'l' }, p.label),
                h('b', { key: 'v', className: 'dsh-tp-legend-val' }, formatTokens(p.value)),
                h('span', { key: 'p', className: 'dsh-tp-legend-pct' }, pctText(pctOf(p.value, total), 0)),
              ]),
            ),
          ),
        ])
      }

      function StatCards3({ items }) {
        return h(
          'div',
          { className: 'dsh-tp-grid-3' },
          items.map((it) =>
            h('div', { key: it.key, className: 'dsh-tp-tile' }, [
              h('span', { key: 'l', className: 'dsh-tp-tile-label' }, it.label),
              h('span', { key: 'v', className: 'dsh-tp-tile-val', style: it.color ? { color: it.color } : null }, it.value),
              it.sub ? h('span', { key: 's', className: 'dsh-tp-tile-sub' }, it.sub) : null,
            ]),
          ),
        )
      }

      // ---------- 面板弹窗 ----------

      function TokenStatsModal({ isOpen, onClose, sessionData, globalData, onRefreshGlobal, sessionTitle }) {
        const [tab, setTab] = React.useState('session')
        const [globalRange, setGlobalRange] = React.useState('week')
        const [copied, setCopied] = React.useState(false)
        const theme = useHostTheme()

        React.useEffect(() => {
          if (!isOpen) return
          setTab(sessionData.totalTokens > 0 ? 'session' : 'global')
        }, [isOpen])

        React.useEffect(() => {
          if (!isOpen) return undefined
          const onKey = (e) => {
            if (e.key === 'Escape') onClose()
          }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }, [isOpen, onClose])

        React.useEffect(() => {
          if (!copied) return undefined
          const timer = setTimeout(() => setCopied(false), 2000)
          return () => clearTimeout(timer)
        }, [copied])

        if (!isOpen) return null

        const range = globalData && globalData[globalRange] ? globalData[globalRange] : null
        const rangeData = range || { total: 0, output: 0, input: 0, cacheRead: 0, cachePct: 0, calls: 0, activeDays: 0 }
        const rangeLabel = globalRange === 'today' ? '今日' : globalRange === 'week' ? '近 7 天' : '近 30 天'
        const rangeDays = globalRange === 'today' ? 1 : globalRange === 'week' ? 7 : 30
        const todayStr = todayString()

        const trendRows = (globalData && Array.isArray(globalData.days) ? globalData.days : []).slice(0, rangeDays)
        const trendMax = trendRows.reduce((m, d) => Math.max(m, Number(d.total) || 0), 0)

        const topSessions = (globalData && Array.isArray(globalData.topSessions) ? globalData.topSessions : []).slice(0, 5)
        const topMax = topSessions.reduce((m, s) => Math.max(m, Number(s.total) || 0), 0)

        const sessionTotal = sessionData.totalTokens
        const avgPerActiveDay = rangeData.activeDays > 0 ? rangeData.total / rangeData.activeDays : 0

        const reportLines = () => {
          if (tab === 'session') {
            return [
              '📊 Token 用量 · 当前会话' + (sessionTitle ? '：' + sessionTitle : ''),
              '─────────────────────────────',
              '总消耗        ' + formatTokens(sessionTotal) + '  (' + formatInt(sessionTotal) + ' tokens)',
              '· 缓存读取    ' + formatTokens(sessionData.cacheRead) + '  (' + pctText(pctOf(sessionData.cacheRead, sessionTotal)) + ')',
              '· 未缓存输入  ' + formatTokens(sessionData.uncached) + '  (' + pctText(pctOf(sessionData.uncached, sessionTotal)) + ')',
              '· 补全输出    ' + formatTokens(sessionData.output) + '  (' + pctText(pctOf(sessionData.output, sessionTotal)) + ')',
              '缓存命中率    ' + pctText(sessionData.cachePct),
              sessionData.lastBuckets
                ? '最近一轮      #' + sessionData.lastBuckets.turn + ' 轮 · 第 ' + sessionData.lastBuckets.step + ' 步：生成 ' +
                  formatTokens(sessionData.lastBuckets.output) + '，输入 ' + formatTokens(sessionData.lastBuckets.uncached) +
                  '，缓存 ' + formatTokens(sessionData.lastBuckets.cacheRead) + ' (' + pctText(sessionData.lastBuckets.cachePct) + ')'
                : '',
              sessionData.turns > 0
                ? '会话规模      ' + sessionData.turns + ' 轮 · ' + sessionData.steps + ' 次调用 · 耗时 ' + formatDuration(sessionData.llmMs)
                : '',
            ]
              .filter(Boolean)
              .join('\n')
          }
          const lines = [
            '📊 Token 用量 · 全局 ' + rangeLabel + '统计',
            '─────────────────────────────',
            '总消耗        ' + formatTokens(rangeData.total) + '  (' + formatInt(rangeData.total) + ' tokens)',
            '· 缓存读取    ' + formatTokens(rangeData.cacheRead) + '  (' + pctText(pctOf(rangeData.cacheRead, rangeData.total)) + ')',
            '· 未缓存输入  ' + formatTokens(rangeData.input) + '  (' + pctText(pctOf(rangeData.input, rangeData.total)) + ')',
            '· 补全输出    ' + formatTokens(rangeData.output) + '  (' + pctText(pctOf(rangeData.output, rangeData.total)) + ')',
            '缓存命中率    ' + pctText(rangeData.cachePct),
            '活跃天数      ' + rangeData.activeDays + ' 天 · 日均 ' + formatTokens(avgPerActiveDay),
            '模型交互      ' + formatInt(rangeData.calls) + ' 次',
          ]
          if (trendRows.length > 0) {
            lines.push('', '每日走势：')
            trendRows.forEach((d) => {
              lines.push(
                '  ' + d.date + '  ' + formatTokens(d.total) + '  (输出 ' + formatTokens(d.output) +
                  ' / 缓存 ' + formatTokens(d.cacheRead) + ' / 命中 ' + pctText(d.cachePct) + ')',
              )
            })
          }
          if (topSessions.length > 0) {
            lines.push('', '活跃会话 TOP：')
            topSessions.forEach((s, i) => {
              lines.push('  ' + (i + 1) + '. ' + s.title + '  ' + formatTokens(s.total) + '  (缓存 ' + pctText(s.cachePct) + ')')
            })
          }
          return lines.join('\n')
        }

        const handleCopy = () => {
          const text = reportLines()
          const done = () => setCopied(true)
          try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              navigator.clipboard.writeText(text).then(done).catch(done)
            } else {
              done()
            }
          } catch {
            done()
          }
        }

        const segItem = (key, label, on, onClick) =>
          h(
            'button',
            {
              key,
              type: 'button',
              className: 'dsh-tp-seg-item' + (on ? ' dsh-tp-seg-item-on' : ''),
              onClick,
            },
            label,
          )

        // ---- 当前会话内容 ----
        const sessionBody = [
          h('div', { key: 'hero', className: 'dsh-tp-hero' }, [
            h('div', { key: 'hdr', className: 'dsh-tp-hero-header' }, [
              h('span', { key: 'l', className: 'dsh-tp-hero-label' }, '当前会话累计消耗'),
              h('span', { key: 'e', className: 'dsh-tp-hero-exact' }, formatInt(sessionTotal) + ' tokens'),
            ]),
            h('div', { key: 'num', className: 'dsh-tp-hero-num' }, [
              h('span', { key: 'v', className: 'dsh-tp-hero-val' }, formatTokens(sessionTotal)),
              h('span', { key: 'u', className: 'dsh-tp-hero-unit' }, 'tokens'),
            ]),
            h(CompositionBar, {
              key: 'comp',
              output: sessionData.output,
              input: sessionData.uncached,
              cacheRead: sessionData.cacheRead,
            }),
          ]),

          h(StatCards3, {
            key: 'stats',
            items: [
              {
                key: 'hit',
                label: '缓存命中率',
                value: pctText(sessionData.cachePct),
                sub: '已节省 ' + formatTokens(sessionData.cacheRead) + ' tok',
                color: C_CACHE,
              },
              {
                key: 'scale',
                label: '交互规模',
                value: (sessionData.turns || 0) + ' 轮 · ' + (sessionData.steps || 0) + ' 次',
                sub: sessionData.turns > 0 ? '均轮 ' + Math.round(sessionData.steps / sessionData.turns) + ' 次调用' : '次交互',
              },
              {
                key: 'time',
                label: '模型耗时',
                value: formatDuration(sessionData.llmMs),
                sub: sessionData.ttftSteps > 0 ? '首字 TTFT ' + formatDuration(sessionData.ttftMs / sessionData.ttftSteps) : '累计推理时间',
              },
            ],
          }),

          sessionData.lastBuckets
            ? h('div', { key: 'last', className: 'dsh-tp-last-card' }, [
                h('div', { key: 'lh', className: 'dsh-tp-last-head' }, [
                  h('span', { key: 't', className: 'dsh-tp-last-title' }, '最近一轮交互'),
                  h('span', { key: 'i' }, '#' + sessionData.lastBuckets.turn + ' 轮 · 第 ' + sessionData.lastBuckets.step + ' 步'),
                ]),
                h('div', { key: 'chips', className: 'dsh-tp-last-chips' }, [
                  h('span', { key: 'c1', className: 'dsh-tp-chip' }, [
                    h('i', { key: 'd', className: 'dsh-tp-dot', style: { background: C_CACHE } }),
                    h('span', { key: 'l', className: 'dsh-tp-chip-dim' }, '缓存读取'),
                    h('b', { key: 'v' }, formatTokens(sessionData.lastBuckets.cacheRead)),
                    h('span', { key: 'p', className: 'dsh-tp-chip-dim' }, '(' + pctText(sessionData.lastBuckets.cachePct, 0) + ')'),
                  ]),
                  h('span', { key: 'c2', className: 'dsh-tp-chip' }, [
                    h('i', { key: 'd', className: 'dsh-tp-dot', style: { background: C_IN } }),
                    h('span', { key: 'l', className: 'dsh-tp-chip-dim' }, '未缓存输入'),
                    h('b', { key: 'v' }, formatTokens(sessionData.lastBuckets.uncached)),
                  ]),
                  h('span', { key: 'c3', className: 'dsh-tp-chip' }, [
                    h('i', { key: 'd', className: 'dsh-tp-dot', style: { background: C_OUT } }),
                    h('span', { key: 'l', className: 'dsh-tp-chip-dim' }, '补全输出'),
                    h('b', { key: 'v' }, formatTokens(sessionData.lastBuckets.output)),
                  ]),
                ]),
              ])
            : null,
        ]

        // ---- 全局统计内容 ----
        const globalBody =
          globalData === null
            ? [
                h('div', { key: 'empty', className: 'dsh-tp-empty' }, [
                  h('div', { key: 'i', className: 'dsh-tp-empty-icon' }, '📊'),
                  h('div', { key: 't', className: 'dsh-tp-empty-title' }, '全局统计服务就绪中'),
                  h(
                    'div',
                    { key: 'd', className: 'dsh-tp-empty-desc' },
                    '正在聚合本机历史账本与近 48 小时会话。若长时间未载入，请点击重新连接。',
                  ),
                  h(
                    'button',
                    { key: 'r', type: 'button', className: 'dsh-tp-btn-ghost', onClick: onRefreshGlobal },
                    '⟳ 刷新连接',
                  ),
                ]),
              ]
            : [
                h('div', { key: 'hero', className: 'dsh-tp-hero' }, [
                  h('div', { key: 'hdr', className: 'dsh-tp-hero-header' }, [
                    h('span', { key: 'l', className: 'dsh-tp-hero-label' }, rangeLabel + '总消耗'),
                    h('span', { key: 'e', className: 'dsh-tp-hero-exact' }, formatInt(rangeData.total) + ' tokens'),
                  ]),
                  h('div', { key: 'num', className: 'dsh-tp-hero-num' }, [
                    h('span', { key: 'v', className: 'dsh-tp-hero-val' }, formatTokens(rangeData.total)),
                    h('span', { key: 'u', className: 'dsh-tp-hero-unit' }, 'tokens'),
                  ]),
                  h(CompositionBar, {
                    key: 'comp',
                    output: rangeData.output,
                    input: rangeData.input,
                    cacheRead: rangeData.cacheRead,
                  }),
                ]),

                h(StatCards3, {
                  key: 'tiles',
                  items: [
                    {
                      key: 'hit',
                      label: '缓存命中率',
                      value: pctText(rangeData.cachePct),
                      sub: '节省 ' + formatTokens(rangeData.cacheRead) + ' tok',
                      color: C_CACHE,
                    },
                    {
                      key: 'calls',
                      label: '模型交互',
                      value: formatInt(rangeData.calls) + ' 次',
                      sub: '活跃 ' + rangeData.activeDays + ' 天',
                    },
                    {
                      key: 'avg',
                      label: '日均消耗',
                      value: formatTokens(avgPerActiveDay),
                      sub: rangeLabel + '平均',
                    },
                  ],
                }),

                trendRows.length > 0
                  ? h('div', { key: 'trend', className: 'dsh-tp-sec' }, [
                      h('div', { key: 'h', className: 'dsh-tp-sec-head' }, [
                        h('span', { key: 't', className: 'dsh-tp-sec-title' }, '每日走势'),
                        h('span', { key: 'i', className: 'dsh-tp-sec-hint' }, '最高 ' + formatTokens(trendMax)),
                      ]),
                      h(
                        'div',
                        { key: 'rows', className: 'dsh-tp-trend' },
                        trendRows.map((d) => {
                          const isToday = d.date === todayStr
                          const parts = dayParts(d.date)
                          return h(
                            'div',
                            {
                              key: d.date,
                              className: 'dsh-tp-trend-row' + (isToday ? ' dsh-tp-trend-row-today' : ''),
                              title:
                                d.date + '：总 ' + formatInt(d.total) + '，输出 ' + formatInt(d.output) +
                                '，未缓存 ' + formatInt(d.input) + '，缓存 ' + formatInt(d.cacheRead),
                            },
                            [
                              h(
                                'span',
                                { key: 'd', className: 'dsh-tp-trend-date' + (isToday ? ' dsh-tp-trend-date-today' : '') },
                                isToday ? '今天' : parts.md + (parts.wd ? ' ' + parts.wd : ''),
                              ),
                              h('div', { key: 'b', className: 'dsh-tp-track' }, [
                                h('div', {
                                  key: 'f',
                                  className: 'dsh-tp-track-fill',
                                  style: {
                                    width: (trendMax > 0 ? pctOf(d.total, trendMax) : 0) + '%',
                                    background: 'linear-gradient(90deg, var(--dsh-tp-out), var(--dsh-tp-out-weak))',
                                  },
                                }),
                              ]),
                              h('span', { key: 't', className: 'dsh-tp-trend-total' }, formatTokens(d.total)),
                              h('span', { key: 'c', className: 'dsh-tp-trend-cache' }, pctText(d.cachePct, 0)),
                            ],
                          )
                        }),
                      ),
                    ])
                  : null,

                topSessions.length > 0
                  ? h('div', { key: 'top', className: 'dsh-tp-sec' }, [
                      h('div', { key: 'h', className: 'dsh-tp-sec-head' }, [
                        h('span', { key: 't', className: 'dsh-tp-sec-title' }, '活跃会话 TOP ' + topSessions.length),
                        h('span', { key: 'i', className: 'dsh-tp-sec-hint' }, '按总消耗排序'),
                      ]),
                      h(
                        'div',
                        { key: 'rows', className: 'dsh-tp-rank' },
                        topSessions.map((s, i) =>
                          h(
                            'div',
                            { key: s.id, className: 'dsh-tp-rank-row', title: s.title + '：' + formatInt(s.total) + ' tokens' },
                            [
                              h('span', { key: 'n', className: 'dsh-tp-rank-no' }, String(i + 1)),
                              h('div', { key: 'm', className: 'dsh-tp-rank-main' }, [
                                h('span', { key: 't', className: 'dsh-tp-rank-title' }, s.title || '未命名会话'),
                                h('div', { key: 'b', className: 'dsh-tp-rank-track' }, [
                                  h('div', {
                                    key: 'f',
                                    className: 'dsh-tp-rank-fill',
                                    style: { width: (topMax > 0 ? pctOf(s.total, topMax) : 0) + '%' },
                                  }),
                                ]),
                              ]),
                              h('div', { key: 'v', className: 'dsh-tp-rank-num' }, [
                                h('span', { key: 't', className: 'dsh-tp-rank-total' }, formatTokens(s.total)),
                                h(
                                  'span',
                                  { key: 's', className: 'dsh-tp-rank-sub' },
                                  '输出 ' + formatTokens(s.output) + ' · 缓 ' + pctText(s.cachePct, 0),
                                ),
                              ]),
                            ],
                          ),
                        ),
                      ),
                    ])
                  : null,
              ]

        const overlay = h(
          'div',
          { className: 'dsh-tp-scope dsh-tp-overlay', 'data-dsh-tp-theme': theme, onClick: onClose },
          [
            h(
              'div',
              {
                key: 'dialog',
                className: 'dsh-tp-dialog',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': 'Token 用量分析',
                onClick: (e) => e.stopPropagation(),
              },
              [
                // 头部
                h('div', { key: 'head', className: 'dsh-tp-head' }, [
                  h('span', { key: 'badge', className: 'dsh-tp-badge' }, '⚡'),
                  h('div', { key: 'text', className: 'dsh-tp-head-text' }, [
                    h('span', { key: 't', className: 'dsh-tp-head-title' }, 'Token 用量分析'),
                    h(
                      'span',
                      { key: 's', className: 'dsh-tp-head-sub' },
                      tab === 'session'
                        ? sessionTitle
                          ? sessionTitle
                          : '当前会话'
                        : '全局 · ' + rangeLabel,
                    ),
                  ]),
                  h(
                    'button',
                    {
                      key: 'refresh',
                      type: 'button',
                      className: 'dsh-tp-icon-btn',
                      title: '刷新全局统计',
                      'aria-label': '刷新全局统计',
                      onClick: onRefreshGlobal,
                    },
                    '⟳',
                  ),
                  h(
                    'button',
                    {
                      key: 'close',
                      type: 'button',
                      className: 'dsh-tp-icon-btn',
                      title: '关闭 (Esc)',
                      'aria-label': '关闭',
                      onClick: onClose,
                    },
                    '✕',
                  ),
                ]),

                // 导航与过滤栏
                h('div', { key: 'nav', className: 'dsh-tp-nav' }, [
                  h('div', { key: 'main-tabs', className: 'dsh-tp-seg' }, [
                    segItem('t1', '当前会话', tab === 'session', () => setTab('session')),
                    segItem('t2', '全局统计', tab === 'global', () => setTab('global')),
                  ]),
                  tab === 'global'
                    ? h('div', { key: 'range-tabs', className: 'dsh-tp-seg' }, [
                        segItem('r1', '今日', globalRange === 'today', () => setGlobalRange('today')),
                        segItem('r2', '近 7 天', globalRange === 'week', () => setGlobalRange('week')),
                        segItem('r3', '近 30 天', globalRange === 'month', () => setGlobalRange('month')),
                      ])
                    : null,
                ]),

                // 内容区
                h('div', { key: 'body', className: 'dsh-tp-body' }, tab === 'session' ? sessionBody : globalBody),

                // 底部操作栏
                h('div', { key: 'foot', className: 'dsh-tp-foot' }, [
                  h(
                    'span',
                    { key: 'note', className: 'dsh-tp-foot-note' },
                    tab === 'session' ? '实时统计 · 随会话更新' : '聚合自本机历史账本与近 48 小时会话',
                  ),
                  h('div', { key: 'actions', className: 'dsh-tp-foot-actions' }, [
                    h(
                      'button',
                      { key: 'copy', type: 'button', className: 'dsh-tp-btn-ghost', onClick: handleCopy },
                      copied ? '✓ 已复制' : '复制报告',
                    ),
                    h('button', { key: 'done', type: 'button', className: 'dsh-tp-btn-primary', onClick: onClose }, '完成'),
                  ]),
                ]),
              ],
            ),
          ],
        )

        return portalToBody(overlay)
      }

      // ---------- 胶囊操作入口 ----------

      function TokenPillAction(props) {
        const useProjection = typeof props.useProjection === 'function' ? props.useProjection : null
        const rawUsage = useProjection ? useProjection('tokenUsage') : null
        const rawMeasurement = useProjection ? useProjection('tokenMeasurement') : null
        const rawStats = useProjection ? useProjection('sessionStats') : null
        const rawTitle = useProjection ? useProjection('title') : null

        const sessionStats = rawStats && rawStats.val ? rawStats.val : rawStats
        const titleVal = rawTitle && rawTitle.val ? rawTitle.val : rawTitle
        const sessionTitle =
          typeof titleVal === 'string' ? titleVal : titleVal && typeof titleVal.title === 'string' ? titleVal.title : ''

        const [modalOpen, setModalOpen] = React.useState(false)
        const [globalData, setGlobalData] = React.useState(null)
        const theme = useHostTheme()

        const fetchGlobalStats = React.useCallback(() => {
          const url = typeof document !== 'undefined' ? new URL(STATS_ROUTE, document.baseURI).href : STATS_ROUTE
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

        // 统一可靠提取数据
        const { uncached, output, cacheRead, cacheWrite } = extractTokenTotals(rawUsage, rawMeasurement)
        const totalInput = uncached + cacheRead
        const totalTokens = totalInput + output
        const cachePct = pctOf(cacheRead, totalInput)

        const lastBuckets = extractLastBuckets(rawUsage)

        const sessionData = {
          totalTokens,
          output,
          uncached,
          cacheRead,
          cacheWrite,
          cachePct,
          lastBuckets,
          turns: Number((sessionStats && sessionStats.turns) || 0),
          steps: Number((sessionStats && sessionStats.steps) || 0),
          llmMs: Number((sessionStats && sessionStats.llmMs) || 0),
          ttftMs: Number((sessionStats && sessionStats.ttftMs) || 0),
          ttftSteps: Number((sessionStats && sessionStats.ttftSteps) || 0),
        }

        const openModal = (e) => {
          e.stopPropagation()
          fetchGlobalStats()
          setModalOpen(true)
        }

        const modal = h(TokenStatsModal, {
          key: 'modal',
          isOpen: modalOpen,
          onClose: () => setModalOpen(false),
          sessionData,
          globalData,
          onRefreshGlobal: fetchGlobalStats,
          sessionTitle,
        })

        // 空会话 / 首页：输入区保留「⚡ 0」，头部不显示
        if (totalTokens <= 0) {
          if (props.placement === 'header') return null
          return h('span', { className: 'dsh-tp-scope dsh-tp-group', 'data-dsh-tp-theme': theme }, [
            h(
              'button',
              {
                key: 'btn',
                type: 'button',
                className: 'dsh-tp-btn dsh-tp-btn-empty',
                title: 'Token 用量：本会话暂无消耗\n点击查看今日 / 近 7 天 / 近 30 天统计',
                'aria-label': 'Token 用量：0',
                onClick: openModal,
              },
              [
                h('span', { key: 'icon', className: 'dsh-tp-icon dsh-tp-icon-dim' }, '⚡'),
                h('span', { key: 'zero', className: 'dsh-tp-main dsh-tp-dim' }, '0'),
              ],
            ),
            modal,
          ])
        }

        const children = [h('span', { key: 'icon', className: 'dsh-tp-icon' }, '⚡')]
        if (output > 0 && cacheRead > 0) {
          children.push(
            h('span', { key: 'out', className: 'dsh-tp-main' }, formatTokens(output)),
            h('span', { key: 'sep', className: 'dsh-tp-cache' }, ' · 缓 ' + (cachePct >= 99.5 ? '99+' : Math.round(cachePct)) + '%'),
          )
        } else if (output > 0 && uncached > 0) {
          children.push(
            h('span', { key: 'both', className: 'dsh-tp-main' }, formatTokens(output) + ' 出 · ' + formatTokens(uncached) + ' 入'),
          )
        } else if (output > 0) {
          children.push(h('span', { key: 'out', className: 'dsh-tp-main' }, formatTokens(output) + ' 出'))
        } else {
          children.push(h('span', { key: 'total', className: 'dsh-tp-main' }, formatTokens(totalTokens) + ' token'))
        }

        const tooltip =
          'Token 用量 · 点击查看明细\n总消耗 ' + formatTokens(totalTokens) +
          '（输出 ' + formatTokens(output) + ' · 缓存 ' + pctText(cachePct, 0) + '）'

        return h('span', { className: 'dsh-tp-scope dsh-tp-group', 'data-dsh-tp-theme': theme }, [
          h(
            'button',
            {
              key: 'btn',
              type: 'button',
              className: 'dsh-tp-btn',
              title: tooltip,
              'aria-label': tooltip,
              onClick: openModal,
            },
            children,
          ),
          modal,
        ])
      }

      // ---------- 插件注册 ----------

      function apply(ctx) {
        ensureStyle()
        if (!ctx.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return

        // 1. 会话头部工具栏
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

        // 2. 输入框右侧工具条
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
