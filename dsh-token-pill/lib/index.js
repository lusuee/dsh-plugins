// dsh-token-pill — host half.
//
// Computes and serves aggregate token statistics (today, last 7 days, last 30 days,
// daily breakdown, top sessions) by reading the cost-meter ledger, session logs and
// session projection cache.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import * as zlib from 'node:zlib'

export const name = 'dsh-token-pill'
export const STATS_ROUTE = '/__dsh-token-pill/stats'

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const SESSION_LOG_MAX_DEPTH = 4

// file -> { mtimeMs, size, id, title, lastAt, totals, daily }
const sessionLogCache = new Map()

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', String(Buffer.byteLength(payload)))
  res.end(payload)
}

function rejected(ctx, req, res) {
  const connection = ctx.connection
  if (connection === undefined || connection === null) return false
  if (typeof connection.requestRejection !== 'function') return false
  const rejection = connection.requestRejection(req)
  if (rejection === undefined || rejection === null) return false
  res.statusCode = typeof rejection === 'number' ? rejection : 403
  res.end()
  return true
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

// 按本地时区取日期，避免 UTC 零点把夜间用量算到前一天/后一天。
function localDateKey(ms) {
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return ''
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function localDayStart(ms) {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 }
}

function addUsage(target, u) {
  target.input += Number(u.inputTokens || 0)
  target.output += Number(u.outputTokens || 0)
  target.cacheRead += Number(u.cacheReadTokens || 0)
  target.cacheWrite += Number(u.cacheWriteTokens || 0)
}

function usageTotal(v) {
  return Number(v.input || 0) + Number(v.output || 0) + Number(v.cacheRead || 0)
}

function collectSessionLogs(dir, depth, out) {
  if (depth > SESSION_LOG_MAX_DEPTH) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const filePath = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSessionLogs(filePath, depth + 1, out)
    } else if (/\.jsonl(\.zstd)?$/.test(entry.name)) {
      out.push(filePath)
    }
  }
}

function readCompressed(filePath) {
  if (!filePath.endsWith('.zstd')) return readFileSync(filePath, 'utf8')
  const raw = readFileSync(filePath)
  if (typeof zlib.zstdDecompressSync === 'function') {
    return zlib.zstdDecompressSync(raw).toString('utf8')
  }
  // 老版本 Node 没有 zstd 绑定时的兜底；需要系统安装 zstd。
  return execFileSync('zstd', ['-dc', filePath], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8')
}

function parseSessionLog(filePath) {
  const text = readCompressed(filePath)
  let id = basename(dirname(filePath)) || ''
  let title = ''
  let lastAt = 0
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const daily = {}

  for (const line of text.split('\n')) {
    if (!line) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'session' && event.id) {
      id = event.id
      continue
    }
    if (event.type === 'session/title' && event.data && typeof event.data.title === 'string') {
      title = event.data.title
      continue
    }
    if (event.type !== 'assistant/message' || !event.data || !event.data.usage) continue

    const at = Number(event.time)
    if (!Number.isFinite(at) || at <= 0) continue
    const u = event.data.usage
    const input = Number(u.inputTokens || 0)
    const output = Number(u.outputTokens || 0)
    const cacheRead = Number(u.cacheReadTokens || 0)
    const cacheWrite = Number(u.cacheWriteTokens || 0)
    if (input + output + cacheRead + cacheWrite <= 0) continue

    const date = localDateKey(at)
    if (!date) continue
    const slot = daily[date] || (daily[date] = emptyUsage())
    slot.input += input
    slot.output += output
    slot.cacheRead += cacheRead
    slot.cacheWrite += cacheWrite
    slot.calls++

    totals.input += input
    totals.output += output
    totals.cacheRead += cacheRead
    totals.cacheWrite += cacheWrite
    lastAt = Math.max(lastAt, at)
  }

  return { id, title, lastAt, totals, daily }
}

// 增量刷新会话日志缓存：只重新解析 mtime/size 发生变化的文件。
function refreshSessionLogs(sessionRoot) {
  const files = []
  collectSessionLogs(sessionRoot, 0, files)
  const live = new Set(files)

  for (const filePath of files) {
    let stat
    try {
      stat = statSync(filePath)
    } catch {
      continue
    }
    const cached = sessionLogCache.get(filePath)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) continue
    try {
      const parsed = parseSessionLog(filePath)
      parsed.filePath = filePath
      parsed.mtimeMs = stat.mtimeMs
      parsed.size = stat.size
      sessionLogCache.set(filePath, parsed)
    } catch {
      // 会话正在写入时压缩帧可能不完整，保留上一次成功解析的结果。
      if (!cached) sessionLogCache.delete(filePath)
    }
  }

  for (const filePath of sessionLogCache.keys()) {
    if (!live.has(filePath)) sessionLogCache.delete(filePath)
  }

  return Array.from(sessionLogCache.values())
}

function buildLedgerData() {
  const dshDir = join(homedir(), '.dsh')
  const ledgerPath = join(dshDir, 'storages', 'cost-meter', 'ledger.json')
  const allDays = {}
  const sessionsMap = new Map()

  if (!existsSync(ledgerPath)) return { allDays, sessionsMap }

  try {
    const cm = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    if (!cm || !cm.days) return { allDays, sessionsMap }
    for (const [date, value] of Object.entries(cm.days)) {
      allDays[date] = {
        input: Number(value.input || 0),
        output: Number(value.output || 0),
        cacheRead: Number(value.cacheRead || 0),
        cacheWrite: Number(value.cacheWrite || 0),
        calls: Number(value.calls || 0),
      }
      if (!Array.isArray(value.sessions)) continue
      for (const session of value.sessions) {
        if (!session || !session.id) continue
        const rec = sessionsMap.get(session.id) || {
          id: session.id,
          title: session.title || '无标题会话',
          input: 0,
          output: 0,
          cacheRead: 0,
          lastAt: 0,
        }
        rec.input += Number(session.input || 0)
        rec.output += Number(session.output || 0)
        rec.cacheRead += Number(session.cacheRead || 0)
        if (!rec.title && session.title) rec.title = session.title
        rec.lastAt = Math.max(rec.lastAt, Number(session.at || 0))
        sessionsMap.set(session.id, rec)
      }
    }
  } catch {
    // 损坏的账本不影响会话日志回退。
  }

  return { allDays, sessionsMap }
}

function logFilePriority(filePath) {
  if (/\.v4\.jsonl(\.zstd)?$/.test(filePath)) return 3
  if (/\.jsonl\.zstd$/.test(filePath)) return 2
  return 1
}

// 同一会话在迁移后可能同时存在旧版和新版日志，按格式优先级去重，避免重复累计。
function canonicalSessionLogs() {
  const chosen = new Map()
  for (const rec of sessionLogCache.values()) {
    const previous = chosen.get(rec.id)
    if (!previous) {
      chosen.set(rec.id, rec)
      continue
    }
    const priority = logFilePriority(rec.filePath)
    const previousPriority = logFilePriority(previous.filePath)
    if (
      priority > previousPriority ||
      (priority === previousPriority &&
        (rec.lastAt > previous.lastAt ||
          (rec.lastAt === previous.lastAt && usageTotal(rec.totals) > usageTotal(previous.totals))))
    ) {
      chosen.set(rec.id, rec)
    }
  }
  return Array.from(chosen.values())
}

function buildLogData() {
  const allDays = {}
  const sessionsMap = new Map()

  for (const rec of canonicalSessionLogs()) {
    for (const [date, usage] of Object.entries(rec.daily)) {
      const day = allDays[date] || (allDays[date] = emptyUsage())
      day.input += usage.input
      day.output += usage.output
      day.cacheRead += usage.cacheRead
      day.cacheWrite += usage.cacheWrite
      day.calls += usage.calls
    }

    sessionsMap.set(rec.id, {
      id: rec.id,
      title: rec.title || '未命名会话',
      input: rec.totals.input,
      output: rec.totals.output,
      cacheRead: rec.totals.cacheRead,
      lastAt: rec.lastAt,
    })
  }

  return { allDays, sessionsMap }
}

// 账本作为兜底：只补充会话日志没有覆盖、或当天总量更完整的数据。
function mergeLedgerData(allDays, sessionsMap, ledger) {
  for (const [date, value] of Object.entries(ledger.allDays)) {
    const current = allDays[date]
    if (!current || usageTotal(value) > usageTotal(current)) {
      allDays[date] = { ...value }
    }
  }
  for (const [id, rec] of ledger.sessionsMap) {
    const current = sessionsMap.get(id)
    if (!current || usageTotal(rec) > usageTotal(current)) {
      sessionsMap.set(id, { ...rec })
    }
  }
}

function mergeProjectionCache(allDays, sessionsMap, todayStr, now, dshDir) {
  const projDir = join(dshDir, 'storages', 'session_projcache', 'sessions')
  if (!existsSync(projDir)) return

  try {
    const files = readdirSync(projDir)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const filePath = join(projDir, file)
      let stat
      try {
        stat = statSync(filePath)
      } catch {
        continue
      }
      if (now - stat.mtimeMs > 48 * HOUR) continue

      try {
        const session = JSON.parse(readFileSync(filePath, 'utf8'))
        const tu = session.record?.rows?.tokenUsage?.val?.totals
        if (!tu) continue
        const title =
          session.record?.rows?.title?.val?.title ||
          session.record?.rows?.title?.val ||
          session.record?.rows?.title ||
          '未命名会话'
        const sessionId = session.record?.identity?.id || file.replace(/\.json$/, '')

        const projected = {
          input: Number(tu.uncachedInputTokens || 0),
          output: Number(tu.outputTokens || 0),
          cacheRead: Number(tu.cacheReadTokens || 0),
          cacheWrite: Number(tu.cacheWriteTokens || 0),
        }
        const recorded = sessionsMap.get(sessionId) || {
          id: sessionId,
          input: 0,
          output: 0,
          cacheRead: 0,
        }

        // projection 是会话完整总量；只把尚未写进日志/账本的增量归到今日。
        const delta = {
          input: Math.max(0, projected.input - Number(recorded.input || 0)),
          output: Math.max(0, projected.output - Number(recorded.output || 0)),
          cacheRead: Math.max(0, projected.cacheRead - Number(recorded.cacheRead || 0)),
          cacheWrite: Math.max(0, projected.cacheWrite - Number(recorded.cacheWrite || 0)),
        }
        if (
          localDateKey(stat.mtimeMs) === todayStr &&
          delta.input + delta.output + delta.cacheRead + delta.cacheWrite > 0
        ) {
          const day = allDays[todayStr] || (allDays[todayStr] = emptyUsage())
          day.input += delta.input
          day.output += delta.output
          day.cacheRead += delta.cacheRead
          day.cacheWrite += delta.cacheWrite
          day.calls++
        }

        sessionsMap.set(sessionId, {
          id: sessionId,
          title: typeof title === 'string' ? title : '未命名会话',
          input: Math.max(Number(recorded.input || 0), projected.input),
          output: Math.max(Number(recorded.output || 0), projected.output),
          cacheRead: Math.max(Number(recorded.cacheRead || 0), projected.cacheRead),
          lastAt: Math.max(Number(recorded.lastAt || 0), stat.mtimeMs),
        })
      } catch {
        // 单个 projection 损坏时跳过。
      }
    }
  } catch {
    // projection 目录不可读时不影响其他数据源。
  }
}

export function aggregateStats() {
  const dshDir = join(homedir(), '.dsh')
  const sessionRoot = join(dshDir, 'sessions')
  const now = Date.now()
  const todayStr = localDateKey(now)

  const ledger = buildLedgerData()
  if (existsSync(sessionRoot)) refreshSessionLogs(sessionRoot)
  const logs = existsSync(sessionRoot) ? buildLogData() : { allDays: {}, sessionsMap: new Map() }
  const allDays = logs.allDays
  const sessionsMap = logs.sessionsMap

  mergeLedgerData(allDays, sessionsMap, ledger)

  if (!allDays[todayStr]) allDays[todayStr] = emptyUsage()
  mergeProjectionCache(allDays, sessionsMap, todayStr, now, dshDir)

  function summarizeRange(daysCount) {
    const span = Math.max(1, Number(daysCount) || 1)
    const cutoff = localDateKey(localDayStart(now) - (span - 1) * DAY)
    let input = 0
    let output = 0
    let cacheRead = 0
    let cacheWrite = 0
    let calls = 0
    let activeDays = 0
    for (const [date, value] of Object.entries(allDays)) {
      if (date < cutoff) continue
      input += value.input
      output += value.output
      cacheRead += value.cacheRead
      cacheWrite += value.cacheWrite
      calls += value.calls
      if (value.input + value.output + value.cacheRead > 0) activeDays++
    }
    const totalInput = input + cacheRead
    const total = totalInput + output
    const cachePct = totalInput > 0 ? (cacheRead / totalInput) * 100 : 0
    return { input, output, cacheRead, cacheWrite, total, cachePct, calls, activeDays }
  }

  const today = summarizeRange(1)
  const week = summarizeRange(7)
  const month = summarizeRange(30)

  // 固定返回最近 30 个自然日（含无用量日），客户端按 1/7/30 截取时才能与日历窗口对齐。
  const daysList = []
  for (let offset = 0; offset < 30; offset++) {
    const date = localDateKey(localDayStart(now) - offset * DAY)
    const value = allDays[date] || emptyUsage()
    const totalInput = value.input + value.cacheRead
    const total = totalInput + value.output
    const cachePct = totalInput > 0 ? (value.cacheRead / totalInput) * 100 : 0
    daysList.push({
      date,
      input: value.input,
      output: value.output,
      cacheRead: value.cacheRead,
      total,
      cachePct,
      calls: value.calls,
    })
  }

  const topSessions = Array.from(sessionsMap.values())
    .map((session) => {
      const totalInput = session.input + session.cacheRead
      const total = totalInput + session.output
      const cachePct = totalInput > 0 ? (session.cacheRead / totalInput) * 100 : 0
      return { ...session, total, cachePct }
    })
    .filter((session) => session.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  return { ok: true, today, week, month, days: daysList, topSessions }
}

export function handleStats(ctx, req, res) {
  if (rejected(ctx, req, res)) return
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('allow', 'GET')
    sendJson(res, 405, { ok: false, reason: 'method-not-allowed' })
    return
  }
  try {
    const data = aggregateStats()
    sendJson(res, 200, data)
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err?.message || err) })
  }
}

export function apply(ctx) {
  ctx.inject(['webServer', 'connection'], (routeCtx) => {
    routeCtx.effect(
      () =>
        routeCtx.webServer.register({
          kind: 'exact',
          path: STATS_ROUTE,
          handler: (req, res) => handleStats(routeCtx, req, res),
        }),
      'dsh-token-pill: stats route',
    )
  })
}