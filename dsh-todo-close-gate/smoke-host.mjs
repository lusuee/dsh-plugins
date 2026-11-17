// Smoke test for the host half: no Cordis host, just a stub context.
// Run with: node smoke-host.mjs
import { apply, name } from './lib/index.js'

const listeners = new Map()
const logger = { info() {}, warn: (m) => console.log('[warn]', m) }
const ctx = {
  logger,
  on(event, handler) {
    const list = listeners.get(event) ?? []
    list.push(handler)
    listeners.set(event, list)
    return () => {}
  },
}
const emit = async (event, ...args) => {
  for (const handler of listeners.get(event) ?? []) await handler(...args)
}

apply(ctx, {})

const session = { id: 's1', header: { origin: 'user', cwd: 'D:/x' } }
let steered = []
const agent = { id: 'a1', session, steer: (message) => steered.push(message) }
const turnStart = (turn) => ({ type: 'turn/start', data: { turn } })
const todoWrite = (todos) => ({ type: 'todo/write', data: { todos } })

const assert = (label, ok) => console.log(ok ? `ok  ${label}` : `FAIL ${label}`)

// 1. 遗留 in_progress -> 拦一次
await emit('session/event', session, turnStart(1))
await emit('session/event', session, todoWrite([
  { content: 'A', status: 'in_progress' },
  { content: 'B', status: 'completed' },
]))
await emit('agent/turn-stopping', { agent, turn: 1 })
assert('legacy in_progress steers once', steered.length === 1)
assert('message shape', steered[0]?.role === 'user'
  && typeof steered[0]?.id === 'string'
  && steered[0]?.source?.kind === 'todo-close-gate'
  && steered[0]?.content?.[0]?.type === 'text')

// 2. 同回合再触发不重复 steer（防死循环）
await emit('agent/turn-stopping', { agent, turn: 1 })
assert('one steer per turn', steered.length === 1)

// 3. 模型收尾后不再拦
await emit('session/event', session, todoWrite([{ content: 'A', status: 'completed' }]))
await emit('agent/turn-stopping', { agent, turn: 1 })
assert('closed list is silent', steered.length === 1)

// 4. 新回合清空后不拦（没有 todowrite 的回合）
await emit('session/event', session, turnStart(2))
await emit('agent/turn-stopping', { agent, turn: 2 })
assert('no todo snapshot -> silent', steered.length === 1)

// 5. pending 默认不拦（gatePending=false）
await emit('session/event', session, todoWrite([{ content: 'C', status: 'pending' }]))
await emit('agent/turn-stopping', { agent, turn: 2 })
assert('pending alone is silent by default', steered.length === 1)

// 6. 子代理会话不打扰
const sub = { id: 's2', header: { origin: 'subagent' } }
const subAgent = { id: 'a2', session: sub, steer: () => steered.push('sub') }
await emit('session/event', sub, todoWrite([{ content: 'D', status: 'in_progress' }]))
await emit('agent/turn-stopping', { agent: subAgent, turn: 1 })
assert('subagent sessions are skipped', steered.length === 1)

// 7. 文本样例
console.log('\n--- sample steer text ---')
console.log(steered[0].content[0].text)
console.log('\nplugin name:', name)
