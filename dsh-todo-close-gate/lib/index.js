/**
 * dsh-todo-close-gate — 回合收尾硬闸。
 *
 * 输入框上方的待办面板直接读会话 `todos` 投影的最后一次快照，回合结束（turn/end）
 * 不会自动收尾，所以只要模型在回合中途写过一次 in_progress 又忘了收尾，面板就会
 * 一直挂着「1 进行中」。光在 AGENTS.md 里写规则挡不住（实测提示里带着规则，模型
 * 照样漏）。
 *
 * 这里用确定性机制兜底：在 `agent/turn-stopping`（回合即将提交边界、但还没提交）
 * 检查该会话最后一份待办快照；若还有 in_progress（可选：还有 pending），就
 * `agent.steer()` 一条消息，逼模型再跑一步把清单收干净。每回合最多 steer 一次，
 * 模型无视也不会死循环。
 *
 * 只读会话事件 + 唯一副作用是一次 steer，且全部包在 try/catch 里：插件自身出问题
 * 只记警告，不影响会话。
 */

import { randomUUID } from 'node:crypto'

/** Stable Loader identity. */
export const name = 'dsh-todo-close-gate'

/** 判定口径：只拦 in_progress；gatePending=true 时连 pending 一起拦。 */
const DEFAULTS = {
  enabled: true,
  gatePending: false,
}

/** 一条 steer 消息里最多列举的条目数，避免消息本身过长。 */
const MAX_LISTED = 8

/** 组装 steer 文本。 */
function steerText(open, pending) {
  const lines = []
  for (const item of open.slice(0, MAX_LISTED)) lines.push(`- [进行中] ${item.content}`)
  if (open.length > MAX_LISTED) lines.push(`- …另有 ${open.length - MAX_LISTED} 项进行中`)
  if (pending.length > 0) {
    for (const item of pending.slice(0, MAX_LISTED)) lines.push(`- [待处理] ${item.content}`)
    if (pending.length > MAX_LISTED) lines.push(`- …另有 ${pending.length - MAX_LISTED} 项待处理`)
  }
  return [
    '收尾检查（todo-close-gate 插件）：本回合的待办清单还没收干净，它现在正显示在输入框上方的待办面板里。',
    '',
    ...lines,
    '',
    '结束本回合之前，请再调用一次 todo_write 把它收掉：',
    '1. 已经做完的条目置 completed；',
    '2. 决定不做的条目直接从清单里删掉；',
    '3. 需要我拍板的条目，内容里写明「待用户决定：<具体问题>」并置 pending。',
    '不要把还在进行中的条目留在清单里跨回合——面板会一直挂在那里。收完不用重复已给过的结论，一句话说明即可。',
  ].join('\n')
}

/**
 * @param ctx Cordis 上下文。
 * @param config 插件配置（来自 cordis.patch.yml 的 config 段）。
 */
export function apply(ctx, config) {
  const settings = { ...DEFAULTS, ...(config !== null && typeof config === 'object' ? config : {}) }
  /** sessionId -> 最后一份 todos 快照 */
  const lists = new Map()
  /** `${agentId}:${turn}` -> 已 steer 过（每回合只拦一次） */
  const gated = new Set()
  const warn = (message) => {
    try {
      ctx.logger?.warn?.(`todo-close-gate: ${message}`)
    } catch {
      /* 日志失败不影响会话 */
    }
  }

  ctx.on('session/event', (session, event) => {
    try {
      if (event === null || typeof event !== 'object') return
      if (event.type === 'todo/write') {
        const todos = event.data?.todos
        lists.set(session.id, Array.isArray(todos) ? todos : [])
        return
      }
      if (event.type === 'turn/start' || event.type === 'turn/end') {
        lists.delete(session.id)
        for (const key of [...gated]) if (key.startsWith(`${session.id}:`)) gated.delete(key)
      }
    } catch (error) {
      warn(`session/event 处理失败：${String(error)}`)
    }
  })

  ctx.on('session/disposed', (session) => {
    try {
      lists.delete(session.id)
    } catch { /* 忽略 */ }
  })

  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    if (settings.enabled === false) return
    try {
      const session = agent?.session
      if (session === undefined || session === null) return
      const header = session.header ?? {}
      // 子代理会话没有那块面板，别去打扰。
      if (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0) return

      const todos = lists.get(session.id)
      if (!Array.isArray(todos) || todos.length === 0) return

      const open = todos.filter((item) => item?.status === 'in_progress')
      const pending = settings.gatePending === true ? todos.filter((item) => item?.status === 'pending') : []
      if (open.length === 0 && pending.length === 0) return

      const key = `${agent.id}:${turn}`
      if (gated.has(key)) return
      gated.add(key)
      // 只保留最近两个回合的标记，避免无限增长。
      if (gated.size > 64) {
        const recent = [...gated].slice(-32)
        gated.clear()
        for (const item of recent) gated.add(item)
      }

      agent.steer({
        role: 'user',
        id: randomUUID(),
        content: [{ type: 'text', text: steerText(open, pending) }],
        source: { kind: 'todo-close-gate' },
      })
    } catch (error) {
      warn(`turn-stopping 拦截失败：${String(error)}`)
    }
  })
}
