// dsh-token-pill — host half.
//
// Computes and serves aggregate token statistics (today, last 7 days, last 30 days,
// daily breakdown, top sessions) by reading cost-meter ledger and session projection cache.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-token-pill'
export const STATS_ROUTE = '/__dsh-token-pill/stats'

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

export function aggregateStats() {
  const home = homedir()
  const dshDir = join(home, '.dsh')
  const ledgerPath = join(dshDir, 'storages', 'cost-meter', 'ledger.json')
  const projDir = join(dshDir, 'storages', 'session_projcache', 'sessions')

  const allDays = {}
  const sessionsMap = new Map()

  // 1. Read ledger.json if exists
  if (existsSync(ledgerPath)) {
    try {
      const cm = JSON.parse(readFileSync(ledgerPath, 'utf8'))
      if (cm && cm.days) {
        for (const [d, v] of Object.entries(cm.days)) {
          allDays[d] = {
            input: Number(v.input || 0),
            output: Number(v.output || 0),
            cacheRead: Number(v.cacheRead || 0),
            cacheWrite: Number(v.cacheWrite || 0),
            calls: Number(v.calls || 0),
          }
          if (Array.isArray(v.sessions)) {
            for (const s of v.sessions) {
              if (s && s.id) {
                sessionsMap.set(s.id, {
                  id: s.id,
                  title: s.title || '无标题会话',
                  input: Number(s.input || 0),
                  output: Number(s.output || 0),
                  cacheRead: Number(s.cacheRead || 0),
                  lastAt: s.at || 0,
                })
              }
            }
          }
        }
      }
    } catch {}
  }

  // 2. Read recent session projections (files updated in last 48h)
  const now = Date.now()
  const todayStr = new Date(now).toISOString().slice(0, 10)
  if (!allDays[todayStr]) {
    allDays[todayStr] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 }
  }

  if (existsSync(projDir)) {
    try {
      const files = readdirSync(projDir)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const filePath = join(projDir, file)
        const stat = statSync(filePath)
        if (now - stat.mtimeMs > 48 * 3600 * 1000) continue
        const mdate = new Date(stat.mtimeMs).toISOString().slice(0, 10)
        try {
          const s = JSON.parse(readFileSync(filePath, 'utf8'))
          const tu = s.record?.rows?.tokenUsage?.val?.totals
          const title =
            s.record?.rows?.title?.val?.title ||
            s.record?.rows?.title?.val ||
            s.record?.rows?.title ||
            '未命名会话'
          const sessionId = s.record?.identity?.id || file.replace(/\.json$/, '')
          if (tu) {
            const input = Number(tu.uncachedInputTokens || 0)
            const output = Number(tu.outputTokens || 0)
            const cacheRead = Number(tu.cacheReadTokens || 0)
            const cacheWrite = Number(tu.cacheWriteTokens || 0)
            if (mdate === todayStr) {
              allDays[todayStr].input += input
              allDays[todayStr].output += output
              allDays[todayStr].cacheRead += cacheRead
              allDays[todayStr].cacheWrite += cacheWrite
              allDays[todayStr].calls++
            }
            sessionsMap.set(sessionId, {
              id: sessionId,
              title: typeof title === 'string' ? title : '未命名会话',
              input,
              output,
              cacheRead,
              lastAt: stat.mtimeMs,
            })
          }
        } catch {}
      }
    } catch {}
  }

  function summarizeRange(daysCount) {
    const cutoff = new Date(now - daysCount * 24 * 3600 * 1000).toISOString().slice(0, 10)
    let input = 0,
      output = 0,
      cacheRead = 0,
      cacheWrite = 0,
      calls = 0,
      activeDays = 0
    for (const [d, v] of Object.entries(allDays)) {
      if (d >= cutoff) {
        input += v.input
        output += v.output
        cacheRead += v.cacheRead
        cacheWrite += v.cacheWrite
        calls += v.calls
        if (v.input + v.output + v.cacheRead > 0) activeDays++
      }
    }
    const totalInput = input + cacheRead
    const total = totalInput + output
    const cachePct = totalInput > 0 ? (cacheRead / totalInput) * 100 : 0
    return { input, output, cacheRead, cacheWrite, total, cachePct, calls, activeDays }
  }

  const today = summarizeRange(0)
  const week = summarizeRange(7)
  const month = summarizeRange(30)

  const daysList = Object.entries(allDays)
    .map(([date, v]) => {
      const totalInput = v.input + v.cacheRead
      const total = totalInput + v.output
      const cachePct = totalInput > 0 ? (v.cacheRead / totalInput) * 100 : 0
      return {
        date,
        input: v.input,
        output: v.output,
        cacheRead: v.cacheRead,
        total,
        cachePct,
        calls: v.calls,
      }
    })
    .filter((d) => d.total > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)

  const topSessions = Array.from(sessionsMap.values())
    .map((s) => {
      const totalInput = s.input + s.cacheRead
      const total = totalInput + s.output
      const cachePct = totalInput > 0 ? (s.cacheRead / totalInput) * 100 : 0
      return { ...s, total, cachePct }
    })
    .filter((s) => s.total > 0)
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
