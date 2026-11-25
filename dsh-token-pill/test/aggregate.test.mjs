import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { zstdCompressSync } from 'node:zlib'

import { aggregateStats } from '../lib/index.js'

const oldHome = process.env.HOME
const home = mkdtempSync(join(tmpdir(), 'dsh-token-pill-'))
process.env.HOME = home

const sessionRoot = join(home, '.dsh', 'sessions', 'workspace')
mkdirSync(sessionRoot, { recursive: true })

function dayAt(offsetDays) {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - offsetDays, 12).getTime()
}

function usageEvent(id, at, usage) {
  return JSON.stringify({
    type: 'assistant/message',
    seq: at,
    time: at,
    data: {
      usage: {
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        cacheWriteTokens: 0,
      },
    },
  })
}

function writeSession(id, title, events, fileName = 'session.v4.jsonl.zstd') {
  const dir = join(sessionRoot, id)
  mkdirSync(dir, { recursive: true })
  const lines = [
    JSON.stringify({ type: 'session', version: 4, id, createdAt: events[0].at }),
    JSON.stringify({ type: 'session/title', time: events[0].at, data: { title } }),
    ...events.map((event) => usageEvent(id, event.at, event.usage)),
  ]
  const body = zstdCompressSync(Buffer.from(lines.join('\n') + '\n'))
  writeFileSync(join(dir, fileName), body)
  return { dir, fileName }
}

const eventsA = [
  { at: dayAt(10), usage: { input: 1000, output: 100, cacheRead: 1000000 } },
  { at: dayAt(2), usage: { input: 2000, output: 200, cacheRead: 2000000 } },
  { at: dayAt(0), usage: { input: 3000, output: 300, cacheRead: 3000000 } },
]
writeSession('session-a', '会话 A', eventsA)
// 旧版日志与新格式并存时，同一会话只能统计一次。
writeSession('session-a', '会话 A', eventsA, 'session.jsonl.zstd')
writeSession('session-b', '会话 B', [
  { at: dayAt(0), usage: { input: 4000, output: 400, cacheRead: 4000000 } },
])

test('aggregateStats 按本地日期汇总并区分今日/7 天/30 天', () => {
  const stats = aggregateStats()

  assert.equal(stats.today.total, 7007700)
  assert.equal(stats.today.activeDays, 1)
  assert.equal(stats.week.total, 9009900)
  assert.equal(stats.week.activeDays, 2)
  assert.equal(stats.month.total, 10011000)
  assert.equal(stats.month.activeDays, 3)

  assert.equal(stats.days.length, 30)
  assert.equal(stats.days[0].total, 7007700)
  assert.equal(stats.days[1].total, 0)
  assert.equal(stats.days[2].total, 2002200)
  assert.equal(stats.days[10].total, 1001100)
  assert.equal(stats.days[29].total, 0)
  assert.equal(stats.topSessions[0].title, '会话 A')
  assert.equal(stats.topSessions[0].total, 6006600)
  assert.equal(stats.topSessions[1].title, '会话 B')
  assert.equal(stats.topSessions[1].total, 4004400)

  // 重复调用走缓存，数值保持稳定。
  assert.deepEqual(aggregateStats(), stats)
})

test('会话日志追加后只增量刷新该会话', () => {
  const before = aggregateStats()
  const { dir, fileName } = writeSession('session-a', '会话 A', [
    ...eventsA,
    { at: dayAt(0), usage: { input: 500, output: 50, cacheRead: 500000 } },
  ])
  const after = aggregateStats()
  assert.equal(after.today.total, before.today.total + 500550)
  assert.equal(after.week.total, before.week.total + 500550)
  assert.equal(after.days.length, 30)
  assert.equal(after.days[0].total, before.days[0].total + 500550)
  rmSync(dir, { recursive: true, force: true })
  rmSync(join(sessionRoot, 'session-b'), { recursive: true, force: true })
  rmSync(join(sessionRoot, 'session-a'), { recursive: true, force: true })
})

test.after(() => {
  process.env.HOME = oldHome
  rmSync(home, { recursive: true, force: true })
})