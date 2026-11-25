// dsh-token-pill — browser half.
//
// A minimal pill in the composer toolbar + session header:
//   [ ⚡ 38.2k · 缓 96% ]
// Clicking it opens the Token 用量分析 panel:
//   - 当前会话：总量构成（输出 / 未缓存输入 / 缓存读取）、命中率、最近一轮、效率
//   - 全局统计：今日 / 近 7 天 / 近 30 天、每日走势条形图、活跃会话 TOP 5
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

      // 面板必须挂到 document.body。Slots 文档对 conversation.input.* 明确要求：
      // "fixed overlays must portal to the document body because the docked composer contains them"。
      // 输入区会为 position:fixed 建立包含块，就地渲染的结果是被裁进那一条输入栏里。
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

      // 语义色：输出=蓝、未缓存输入=橙、缓存读取=绿
      // 语义色：输出=蓝、未缓存输入=橙、缓存读取=绿（按亮/暗主题给值，见 --dsh-tp-*）
      const C_OUT = 'var(--dsh-tp-out)'
      const C_IN = 'var(--dsh-tp-in)'
      const C_CACHE = 'var(--dsh-tp-cache)'

      // 宿主主题：解析一个宿主背景令牌的亮度即可判定亮色/暗色，
      // 因为宿主那 14 个 alias 令牌都是 requiresLightAndDark（同一名字、两套取值）。
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
        } catch {
          /* 探测失败就走下面的兜底 */
        }
        try {
          if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
          }
        } catch {
          /* 兜底也失败就用亮色 */
        }
        return 'light'
      }

      // 必须在组件里所有 return 之前调用（hook）。
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
            try {
              if (observer) observer.disconnect()
            } catch {
              /* ignore */
            }
            try {
              if (media && typeof media.removeEventListener === 'function') media.removeEventListener('change', sync)
            } catch {
              /* ignore */
            }
          }
        }, [])
        return theme
      }

      const STYLE = `
        /* ===== 主题令牌 =====
           宿主只提供下面这些 alias 令牌（--dsw-alias-bg-overlay / bg-layer-1 /
           bg-layer-2 / border-l1 / border-l2 / label-primary / label-secondary /
           brand-primary / state-*），亮暗暗色由宿主自己切换。所以这里只把
           宿主令牌映射到 --dsh-tp-*，本插件独有的语义色（输出/输入/缓存、
           轨道、遮罩、阴影）按亮暗两套给值，通过 data-dsh-tp-theme 切换。 */
        .dsh-tp-scope {
          --dsh-tp-surface: var(--dsw-alias-bg-overlay, #ffffff);
          --dsh-tp-surface-2: var(--dsw-alias-bg-layer-1, #f5f6f8);
          --dsh-tp-surface-3: var(--dsw-alias-bg-layer-2, #eceef2);
          --dsh-tp-border: var(--dsw-alias-border-l1, rgba(16, 20, 28, 0.12));
          --dsh-tp-border-strong: var(--dsw-alias-border-l2, rgba(16, 20, 28, 0.22));
          --dsh-tp-fg: var(--dsw-alias-label-primary, #16181d);
          --dsh-tp-fg-dim: var(--dsw-alias-label-secondary, #575c66);
          --dsh-tp-brand: var(--dsw-alias-brand-primary, #2f6fe0);
          --dsh-tp-track: rgba(16, 20, 28, 0.1);
          --dsh-tp-hover: rgba(16, 20, 28, 0.06);
          --dsh-tp-out: #2f6fe0;
          --dsh-tp-in: #a9630d;
          --dsh-tp-cache: #0c7f5b;
          --dsh-tp-out-soft: rgba(47, 111, 224, 0.16);
          --dsh-tp-out-weak: rgba(47, 111, 224, 0.55);
          --dsh-tp-out-tint: rgba(47, 111, 224, 0.08);
          --dsh-tp-scrim: rgba(16, 20, 28, 0.42);
          --dsh-tp-shadow: 0 20px 50px rgba(16, 20, 28, 0.18), 0 2px 8px rgba(16, 20, 28, 0.1);
          --dsh-tp-on-brand: #ffffff;
          color-scheme: light;
        }
        .dsh-tp-scope[data-dsh-tp-theme='dark'] {
          --dsh-tp-surface: var(--dsw-alias-bg-overlay, #232529);
          --dsh-tp-surface-2: var(--dsw-alias-bg-layer-1, #26282e);
          --dsh-tp-surface-3: var(--dsw-alias-bg-layer-2, #2e3138);
          --dsh-tp-border: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.14));
          --dsh-tp-border-strong: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.26));
          --dsh-tp-fg: var(--dsw-alias-label-primary, #f2f3f5);
          --dsh-tp-fg-dim: var(--dsw-alias-label-secondary, #a9aeb9);
          --dsh-tp-brand: var(--dsw-alias-brand-primary, #7aa7ff);
          --dsh-tp-track: rgba(255, 255, 255, 0.14);
          --dsh-tp-hover: rgba(255, 255, 255, 0.08);
          --dsh-tp-out: #82abff;
          --dsh-tp-in: #eab948;
          --dsh-tp-cache: #3ed3a3;
          --dsh-tp-out-soft: rgba(130, 171, 255, 0.2);
          --dsh-tp-out-weak: rgba(130, 171, 255, 0.6);
          --dsh-tp-out-tint: rgba(130, 171, 255, 0.12);
          --dsh-tp-scrim: rgba(4, 6, 10, 0.62);
          --dsh-tp-shadow: 0 20px 50px rgba(0, 0, 0, 0.52), 0 2px 8px rgba(0, 0, 0, 0.36);
          --dsh-tp-on-brand: #0b1220;
          color-scheme: dark;
        }

        /* ===== 胶囊 ===== */
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
        .dsh-tp-btn-empty { opacity: 0.72; }
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

        /* ===== 面板骨架 =====
           整块由 portal 挂到 document.body：祖先不再有包含块/裁剪，尺寸用确定值。 */
        .dsh-tp-overlay {
          position: fixed;
          inset: 0;
          z-index: 2147483000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          background: var(--dsh-tp-scrim);
          box-sizing: border-box;
          pointer-events: auto;
          animation: dsh-tp-fade 0.14s ease-out;
        }
        .dsh-tp-dialog {
          width: min(700px, 100%);
          max-width: 100%;
          max-height: min(84vh, 720px);
          min-height: 0;
          border-radius: 14px;
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
          animation: dsh-tp-pop 0.16s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes dsh-tp-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsh-tp-pop {
          from { opacity: 0; transform: scale(0.975) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* ===== 顶部 ===== */
        .dsh-tp-head {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 13px 16px 11px;
          flex: 0 0 auto;
        }
        .dsh-tp-badge {
          width: 26px;
          height: 26px;
          flex: 0 0 auto;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          background: var(--dsh-tp-out-soft);
          color: var(--dsh-tp-brand);
        }
        .dsh-tp-head-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
        .dsh-tp-head-title {
          font-size: 13.5px;
          font-weight: 700;
          letter-spacing: 0.01em;
          line-height: 1.3;
          color: var(--dsh-tp-fg);
        }
        .dsh-tp-head-sub {
          font-size: 11px;
          color: var(--dsh-tp-fg-dim);
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
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
          line-height: 1;
          cursor: pointer;
          transition: background 0.14s, color 0.14s, border-color 0.14s;
        }
        .dsh-tp-icon-btn:hover {
          background: var(--dsh-tp-hover);
          border-color: var(--dsh-tp-border);
          color: var(--dsh-tp-fg);
        }

        /* ===== 分段控件（页签 / 时间范围） ===== */
        .dsh-tp-seg-wrap { padding: 0 16px; flex: 0 0 auto; }
        .dsh-tp-seg {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 2px;
          border-radius: 8px;
          background: var(--dsh-tp-surface-3);
          border: 1px solid var(--dsh-tp-border);
          box-sizing: border-box;
        }
        .dsh-tp-seg-item {
          padding: 4px 12px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--dsh-tp-fg-dim);
          font: inherit;
          font-size: 11.5px;
          font-weight: 600;
          line-height: 1.4;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.14s, color 0.14s, box-shadow 0.14s;
        }
        .dsh-tp-seg-item:hover { color: var(--dsh-tp-fg); }
        .dsh-tp-seg-item-on {
          background: var(--dsh-tp-surface);
          color: var(--dsh-tp-fg);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16);
        }

        /* ===== 内容区 ===== */
        .dsh-tp-body {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 14px 16px 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .dsh-tp-body::-webkit-scrollbar { width: 8px; }
        .dsh-tp-body::-webkit-scrollbar-thumb {
          background: var(--dsh-tp-track);
          border-radius: 4px;
        }
        .dsh-tp-body::-webkit-scrollbar-track { background: transparent; }

        /* ===== 主数字卡 ===== */
        .dsh-tp-hero {
          padding: 13px 14px;
          border-radius: 10px;
          background: var(--dsh-tp-surface-2);
          border: 1px solid var(--dsh-tp-border);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .dsh-tp-hero-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: var(--dsh-tp-fg-dim);
        }
        .dsh-tp-hero-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
          flex-wrap: wrap;
        }
        .dsh-tp-hero-val {
          font-size: 27px;
          font-weight: 750;
          line-height: 1.1;
          letter-spacing: -0.01em;
          font-variant-numeric: tabular-nums;
          color: var(--dsh-tp-fg);
        }
        .dsh-tp-hero-unit {
          font-size: 12px;
          font-weight: 600;
          color: var(--dsh-tp-fg-dim);
        }
        .dsh-tp-hero-exact {
          margin-left: auto;
          font-size: 11px;
          color: var(--dsh-tp-fg-dim);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }

        /* 构成条 */
        .dsh-tp-comp-track {
          display: flex;
          width: 100%;
          height: 9px;
          border-radius: 5px;
          overflow: hidden;
          background: var(--dsh-tp-track);
        }
        .dsh-tp-comp-seg { height: 100%; transition: width 0.28s ease; }
        .dsh-tp-comp-seg + .dsh-tp-comp-seg { box-shadow: inset 1px 0 0 rgba(0, 0, 0, 0.16); }
        .dsh-tp-legend {
          display: flex;
          align-items: center;
          gap: 16px;
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
          width: 8px;
          height: 8px;
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
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }

        /* ===== 指标网格 ===== */
        .dsh-tp-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }
        @media (max-width: 560px) {
          .dsh-tp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        .dsh-tp-tile {
          padding: 9px 11px;
          border-radius: 8px;
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
          font-weight: 720;
          line-height: 1.2;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          color: var(--dsh-tp-fg);
        }
        .dsh-tp-tile-sub {
          font-size: 10px;
          color: var(--dsh-tp-fg-dim);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ===== 分区 ===== */
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

        /* ===== 走势条 ===== */
        .dsh-tp-trend {
          display: flex;
          flex-direction: column;
          gap: 1px;
          max-height: 244px;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding-right: 2px;
        }
        .dsh-tp-trend::-webkit-scrollbar { width: 6px; }
        .dsh-tp-trend::-webkit-scrollbar-thumb {
          background: var(--dsh-tp-track);
          border-radius: 3px;
        }
        .dsh-tp-trend-row {
          display: grid;
          grid-template-columns: 86px minmax(0, 1fr) 66px 46px;
          align-items: center;
          gap: 8px;
          padding: 4px 6px;
          border-radius: 6px;
          transition: background 0.12s;
        }
        .dsh-tp-trend-row:hover { background: var(--dsh-tp-hover); }
        .dsh-tp-trend-row-today { background: var(--dsh-tp-out-tint); }
        .dsh-tp-trend-date {
          font-size: 11px;
          color: var(--dsh-tp-fg-dim);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dsh-tp-trend-date-today {
          color: var(--dsh-tp-brand);
          font-weight: 700;
        }
        .dsh-tp-track {
          position: relative;
          height: 8px;
          border-radius: 4px;
          background: var(--dsh-tp-track);
          overflow: hidden;
        }
        .dsh-tp-track-fill {
          position: absolute;
          inset: 0 auto 0 0;
          border-radius: 4px;
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

        /* ===== 会话排行 ===== */
        .dsh-tp-rank { display: flex; flex-direction: column; gap: 2px; }
        .dsh-tp-rank-row {
          display: grid;
          grid-template-columns: 18px minmax(0, 1fr) 120px;
          align-items: center;
          gap: 8px;
          padding: 5px 6px;
          border-radius: 6px;
          transition: background 0.12s;
        }
        .dsh-tp-rank-row:hover { background: var(--dsh-tp-hover); }
        .dsh-tp-rank-no {
          font-size: 10px;
          font-weight: 700;
          text-align: center;
          color: var(--dsh-tp-fg-dim);
          font-variant-numeric: tabular-nums;
        }
        .dsh-tp-rank-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .dsh-tp-rank-title {
          font-size: 12px;
          font-weight: 550;
          line-height: 1.3;
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

        /* ===== 明细行（最近一轮 / 规模） ===== */
        .dsh-tp-detail {
          display: flex;
          flex-direction: column;
          border-radius: 8px;
          border: 1px solid var(--dsh-tp-border);
          background: var(--dsh-tp-surface-2);
          overflow: hidden;
        }
        .dsh-tp-detail-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 7px 11px;
          font-size: 11.5px;
        }
        .dsh-tp-detail-row + .dsh-tp-detail-row {
          border-top: 1px solid var(--dsh-tp-border);
        }
        .dsh-tp-detail-key { color: var(--dsh-tp-fg-dim); font-weight: 550; }
        .dsh-tp-detail-val {
          font-weight: 650;
          font-variant-numeric: tabular-nums;
          text-align: right;
          color: var(--dsh-tp-fg);
        }

        /* ===== 空态 / 加载态 ===== */
        .dsh-tp-empty {
          padding: 40px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 10px;
        }
        .dsh-tp-empty-icon { font-size: 30px; line-height: 1; color: var(--dsh-tp-brand); }
        .dsh-tp-empty-title { font-size: 13.5px; font-weight: 700; color: var(--dsh-tp-fg); }
        .dsh-tp-empty-desc {
          font-size: 12px;
          line-height: 1.65;
          max-width: 400px;
          color: var(--dsh-tp-fg-dim);
        }

        /* ===== 底部 ===== */
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
          padding: 5px 11px;
          border-radius: 6px;
          border: 1px solid var(--dsh-tp-border-strong);
          background: var(--dsh-tp-surface);
          color: var(--dsh-tp-fg);
          font: inherit;
          font-size: 11.5px;
          font-weight: 600;
          line-height: 1.4;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
          transition: background 0.14s, border-color 0.14s;
        }
        .dsh-tp-btn-ghost:hover {
          background: var(--dsh-tp-hover);
          border-color: var(--dsh-tp-border-strong);
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
          line-height: 1.4;
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

      // ---------- 格式化 ----------

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
        // 99.9% 之类不要四舍五入成 100%，避免看起来像"完全命中"
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
        // dateStr: YYYY-MM-DD
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

      // ---------- 小组件 ----------

      function CompositionBar({ output, input, cacheRead }) {
        const total = output + input + cacheRead
        const parts = [
          { key: 'o', label: '输出', value: output, color: C_OUT },
          { key: 'i', label: '未缓存输入', value: input, color: C_IN },
          { key: 'c', label: '缓存读取', value: cacheRead, color: C_CACHE },
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
            { key: 'legend', className: 'dsh-tp-legend' },
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

      function Tiles({ items }) {
        return h(
          'div',
          { className: 'dsh-tp-grid' },
          items.map((it) =>
            h('div', { key: it.key, className: 'dsh-tp-tile' }, [
              h('span', { key: 'l', className: 'dsh-tp-tile-label' }, it.label),
              h('span', { key: 'v', className: 'dsh-tp-tile-val', style: it.color ? { color: it.color } : null }, it.value),
              it.sub ? h('span', { key: 's', className: 'dsh-tp-tile-sub' }, it.sub) : null,
            ]),
          ),
        )
      }

      function DetailRows({ rows }) {
        return h(
          'div',
          { className: 'dsh-tp-detail' },
          rows.map((r) =>
            h('div', { key: r.key, className: 'dsh-tp-detail-row' }, [
              h('span', { key: 'k', className: 'dsh-tp-detail-key' }, r.label),
              h('span', { key: 'v', className: 'dsh-tp-detail-val', style: r.color ? { color: r.color } : null }, r.value),
            ]),
          ),
        )
      }

      // ---------- 面板 ----------

      function TokenStatsModal({ isOpen, onClose, sessionData, globalData, onRefreshGlobal, sessionTitle }) {
        const [tab, setTab] = React.useState('session')
        const [globalRange, setGlobalRange] = React.useState('week')
        const [copied, setCopied] = React.useState(false)
        const theme = useHostTheme()

        // 打开时：有本会话数据就落在「当前会话」，否则直接看全局
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

        // 每日走势（自适应范围）
        // days 已按日期倒序（最新在前），这里保持「今天在最上面」
        const trendRows = (globalData && Array.isArray(globalData.days) ? globalData.days : []).slice(0, rangeDays)
        const trendMax = trendRows.reduce((m, d) => Math.max(m, Number(d.total) || 0), 0)

        const topSessions = (globalData && Array.isArray(globalData.topSessions) ? globalData.topSessions : []).slice(0, 5)
        const topMax = topSessions.reduce((m, s) => Math.max(m, Number(s.total) || 0), 0)

        const sessionTotal = sessionData.totalTokens
        const sessionInputTotal = sessionData.uncached + sessionData.cacheRead
        const avgPerActiveDay = rangeData.activeDays > 0 ? rangeData.total / rangeData.activeDays : 0

        const reportLines = () => {
          if (tab === 'session') {
            return [
              '📊 Token 用量 · 当前会话' + (sessionTitle ? '：' + sessionTitle : ''),
              '─────────────────────────────',
              '总消耗      ' + formatTokens(sessionTotal) + '  (' + formatInt(sessionTotal) + ' tokens)',
              '· 补全输出    ' + formatTokens(sessionData.output) + '  (' + pctText(pctOf(sessionData.output, sessionTotal)) + ')',
              '· 未缓存输入  ' + formatTokens(sessionData.uncached) + '  (' + pctText(pctOf(sessionData.uncached, sessionTotal)) + ')',
              '· 缓存读取    ' + formatTokens(sessionData.cacheRead) + '  (' + pctText(pctOf(sessionData.cacheRead, sessionTotal)) + ')',
              '缓存命中率    ' + pctText(sessionData.cachePct),
              sessionData.lastBuckets
                ? '最近一轮      #' + sessionData.lastTurn + ' 轮 / 第 ' + sessionData.lastStep + ' 步：输出 ' +
                  formatTokens(sessionData.lastOutput) + '，输入 ' + formatTokens(sessionData.lastUncached) +
                  '，缓存 ' + formatTokens(sessionData.lastCacheRead) + ' (' + pctText(sessionData.lastCachePct) + ')'
                : '',
              sessionData.turns > 0
                ? '会话规模      ' + sessionData.turns + ' 轮 · ' + sessionData.steps + ' 次模型调用 · 模型耗时 ' + formatDuration(sessionData.llmMs)
                : '',
            ]
              .filter(Boolean)
              .join('\n')
          }
          const lines = [
            '📊 Token 用量 · 全局' + rangeLabel + '统计',
            '─────────────────────────────',
            '总消耗      ' + formatTokens(rangeData.total) + '  (' + formatInt(rangeData.total) + ' tokens)',
            '· 补全输出    ' + formatTokens(rangeData.output) + '  (' + pctText(pctOf(rangeData.output, rangeData.total)) + ')',
            '· 未缓存输入  ' + formatTokens(rangeData.input) + '  (' + pctText(pctOf(rangeData.input, rangeData.total)) + ')',
            '· 缓存读取    ' + formatTokens(rangeData.cacheRead) + '  (' + pctText(pctOf(rangeData.cacheRead, rangeData.total)) + ')',
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

        // ---- 当前会话视图 ----
        const sessionBody = [
          h('div', { key: 'hero', className: 'dsh-tp-hero' }, [
            h('span', { key: 'l', className: 'dsh-tp-hero-label' }, '当前会话总消耗'),
            h('div', { key: 'r', className: 'dsh-tp-hero-row' }, [
              h('span', { key: 'v', className: 'dsh-tp-hero-val' }, formatTokens(sessionTotal)),
              h('span', { key: 'u', className: 'dsh-tp-hero-unit' }, 'tokens'),
              h('span', { key: 'e', className: 'dsh-tp-hero-exact' }, formatInt(sessionTotal)),
            ]),
            h(CompositionBar, {
              key: 'comp',
              output: sessionData.output,
              input: sessionData.uncached,
              cacheRead: sessionData.cacheRead,
            }),
          ]),

          h(Tiles, {
            key: 'tiles',
            items: [
              {
                key: 'hit',
                label: '缓存命中率',
                value: pctText(sessionData.cachePct),
                sub: formatTokens(sessionData.cacheRead) + ' / ' + formatTokens(sessionInputTotal) + ' 输入',
                color: C_CACHE,
              },
              {
                key: 'calls',
                label: '模型调用',
                value: formatInt(sessionData.steps),
                sub: sessionData.turns > 0 ? sessionData.turns + ' 轮对话' : '次请求',
              },
              {
                key: 'llm',
                label: '模型耗时',
                value: formatDuration(sessionData.llmMs),
                sub: sessionData.ttftSteps > 0 ? '平均首字 ' + formatDuration(sessionData.ttftMs / sessionData.ttftSteps) : '累计推理时间',
              },
              {
                key: 'avg',
                label: '每轮均耗',
                value: formatTokens(sessionData.turns > 0 ? sessionTotal / sessionData.turns : sessionTotal),
                sub: sessionData.turns > 0 ? '按 ' + sessionData.turns + ' 轮均摊' : '暂无轮次',
              },
            ],
          }),

          sessionData.lastBuckets
            ? h('div', { key: 'last', className: 'dsh-tp-sec' }, [
                h('div', { key: 'h', className: 'dsh-tp-sec-head' }, [
                  h('span', { key: 't', className: 'dsh-tp-sec-title' }, '最近一轮开销'),
                  h(
                    'span',
                    { key: 'i', className: 'dsh-tp-sec-hint' },
                    '第 ' + sessionData.lastTurn + ' 轮 · 第 ' + sessionData.lastStep + ' 步',
                  ),
                ]),
                h(DetailRows, {
                  key: 'd',
                  rows: [
                    { key: 'o', label: '补全输出', value: formatTokens(sessionData.lastOutput) + '  (' + formatInt(sessionData.lastOutput) + ')', color: C_OUT },
                    { key: 'i', label: '未缓存输入', value: formatTokens(sessionData.lastUncached) + '  (' + formatInt(sessionData.lastUncached) + ')', color: C_IN },
                    { key: 'c', label: '缓存读取', value: formatTokens(sessionData.lastCacheRead) + '  (' + formatInt(sessionData.lastCacheRead) + ')', color: C_CACHE },
                    { key: 'h', label: '本轮命中率', value: pctText(sessionData.lastCachePct) },
                  ],
                }),
              ])
            : null,

          h('div', { key: 'scale', className: 'dsh-tp-sec' }, [
            h('div', { key: 'h', className: 'dsh-tp-sec-head' }, [
              h('span', { key: 't', className: 'dsh-tp-sec-title' }, '会话规模'),
            ]),
            h(DetailRows, {
              key: 'd',
              rows: [
                { key: 'turns', label: '对话轮次', value: String(sessionData.turns || 0) + ' 轮' },
                { key: 'steps', label: '模型调用', value: String(sessionData.steps || 0) + ' 次' },
                { key: 'llm', label: '模型耗时', value: formatDuration(sessionData.llmMs) },
                {
                  key: 'ttft',
                  label: '平均首字延迟',
                  value: sessionData.ttftSteps > 0 ? formatDuration(sessionData.ttftMs / sessionData.ttftSteps) : '—',
                },
              ],
            }),
          ]),
        ]

        // ---- 全局视图 ----
        const globalBody =
          globalData === null
            ? [
                h('div', { key: 'empty', className: 'dsh-tp-empty' }, [
                  h('div', { key: 'i', className: 'dsh-tp-empty-icon' }, '📊'),
                  h('div', { key: 't', className: 'dsh-tp-empty-title' }, '全局统计服务尚未就绪'),
                  h(
                    'div',
                    { key: 'd', className: 'dsh-tp-empty-desc' },
                    '全局周/月统计由插件后台聚合。新增的路由只在客户端启动时加载，' +
                      '仅按 Ctrl+R 重载界面不会生效——请完全退出 DeepSeek Harness 后重新打开。',
                  ),
                  h(
                    'button',
                    { key: 'r', type: 'button', className: 'dsh-tp-btn-ghost', onClick: onRefreshGlobal },
                    '⟳ 重新连接',
                  ),
                ]),
              ]
            : [
                h('div', { key: 'hero', className: 'dsh-tp-hero' }, [
                  h('span', { key: 'l', className: 'dsh-tp-hero-label' }, rangeLabel + '总消耗'),
                  h('div', { key: 'r', className: 'dsh-tp-hero-row' }, [
                    h('span', { key: 'v', className: 'dsh-tp-hero-val' }, formatTokens(rangeData.total)),
                    h('span', { key: 'u', className: 'dsh-tp-hero-unit' }, 'tokens'),
                    h('span', { key: 'e', className: 'dsh-tp-hero-exact' }, formatInt(rangeData.total)),
                  ]),
                  h(CompositionBar, {
                    key: 'comp',
                    output: rangeData.output,
                    input: rangeData.input,
                    cacheRead: rangeData.cacheRead,
                  }),
                ]),

                h(Tiles, {
                  key: 'tiles',
                  items: [
                    { key: 'hit', label: '缓存命中率', value: pctText(rangeData.cachePct), sub: formatTokens(rangeData.cacheRead) + ' 命中读取', color: C_CACHE },
                    { key: 'avg', label: '日均消耗', value: formatTokens(avgPerActiveDay), sub: '按活跃 ' + rangeData.activeDays + ' 天计' },
                    { key: 'calls', label: '模型交互', value: formatInt(rangeData.calls), sub: '次请求' },
                    { key: 'days', label: '活跃天数', value: String(rangeData.activeDays) + ' 天', sub: rangeLabel + '内' },
                  ],
                }),

                trendRows.length > 0
                  ? h('div', { key: 'trend', className: 'dsh-tp-sec' }, [
                      h('div', { key: 'h', className: 'dsh-tp-sec-head' }, [
                        h('span', { key: 't', className: 'dsh-tp-sec-title' }, '每日走势'),
                        h('span', { key: 'i', className: 'dsh-tp-sec-hint' }, '峰值 ' + formatTokens(trendMax)),
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
                                h('div', { key: 'b', className: 'dsh-tp-track dsh-tp-rank-track' }, [
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
              // 顶部
              h('div', { key: 'head', className: 'dsh-tp-head' }, [
                h('span', { key: 'badge', className: 'dsh-tp-badge' }, '⚡'),
                h('div', { key: 'text', className: 'dsh-tp-head-text' }, [
                  h('span', { key: 't', className: 'dsh-tp-head-title' }, 'Token 用量分析'),
                  h(
                    'span',
                    { key: 's', className: 'dsh-tp-head-sub' },
                    tab === 'session'
                      ? sessionTitle
                        ? '当前会话 · ' + sessionTitle
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

              // 页签
              h('div', { key: 'tabs', className: 'dsh-tp-seg-wrap' }, [
                h('div', { key: 'seg', className: 'dsh-tp-seg' }, [
                  segItem('t1', '当前会话', tab === 'session', () => setTab('session')),
                  segItem('t2', '全局统计', tab === 'global', () => setTab('global')),
                ]),
              ]),

              // 内容
              h('div', { key: 'body', className: 'dsh-tp-body' }, [
                tab === 'global'
                  ? h('div', { key: 'range', className: 'dsh-tp-seg-wrap', style: { padding: 0 } }, [
                      h('div', { key: 'seg', className: 'dsh-tp-seg' }, [
                        segItem('r1', '今日', globalRange === 'today', () => setGlobalRange('today')),
                        segItem('r2', '近 7 天', globalRange === 'week', () => setGlobalRange('week')),
                        segItem('r3', '近 30 天', globalRange === 'month', () => setGlobalRange('month')),
                      ]),
                    ])
                  : null,
                ...(tab === 'session' ? sessionBody : globalBody),
              ]),

              // 底部
              h('div', { key: 'foot', className: 'dsh-tp-foot' }, [
                h(
                  'span',
                  { key: 'note', className: 'dsh-tp-foot-note' },
                  tab === 'session' ? '实时数据 · 随对话更新' : '聚合自本机历史账本与近 48 小时会话',
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
        ])

        return portalToBody(overlay)
      }

      // ---------- 胶囊 ----------

      function TokenPillAction(props) {
        const useProjection = typeof props.useProjection === 'function' ? props.useProjection : null
        const rawUsage = useProjection ? useProjection('tokenUsage') : null
        const rawStats = useProjection ? useProjection('sessionStats') : null
        const rawTitle = useProjection ? useProjection('title') : null

        const tokenUsage = rawUsage && rawUsage.val ? rawUsage.val : rawUsage
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

        const totals = tokenUsage ? tokenUsage.totals : null
        const uncached = Number((totals && totals.uncachedInputTokens) || 0)
        const output = Number((totals && totals.outputTokens) || 0)
        const cacheRead = Number((totals && totals.cacheReadTokens) || 0)
        const cacheWrite = Number((totals && totals.cacheWriteTokens) || 0)
        const totalInput = uncached + cacheRead
        const totalTokens = totalInput + output
        const cachePct = pctOf(cacheRead, totalInput)

        const last = tokenUsage ? tokenUsage.last : null
        const lastBuckets = last ? last.buckets : null
        const lastUncached = Number((lastBuckets && lastBuckets.uncachedInputTokens) || 0)
        const lastOutput = Number((lastBuckets && lastBuckets.outputTokens) || 0)
        const lastCacheRead = Number((lastBuckets && lastBuckets.cacheReadTokens) || 0)

        const sessionData = {
          totalTokens,
          output,
          uncached,
          cacheRead,
          cacheWrite,
          cachePct,
          lastBuckets,
          lastTurn: last ? last.turn : undefined,
          lastStep: last ? last.step : undefined,
          lastOutput,
          lastUncached,
          lastCacheRead,
          lastCachePct: pctOf(lastCacheRead, lastUncached + lastCacheRead),
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

        // 空会话 / 首页：输入区保留一个低调的「⚡ 0」，头部不显示
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

      // ---------- 注册 ----------

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
