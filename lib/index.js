/**
 * Host half of dsh-finance-dock —— 只做一件事：把行情取回来，规范化成客户端要的形状。
 *
 * 数据源：Yahoo Finance 的 chart 接口
 *   https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?range=1mo&interval=1d
 * 选它的原因：免 key、一条请求同时给「最新价 + 前收 + 收盘序列」，sparkline 直接用它。
 * （同机器上试过 stooq 的 CSV，空返回，弃用。）
 *
 * 为什么经宿主中转：Yahoo 在墙外，要走 127.0.0.1:7897；顺带解决 CORS，客户端只认同源。
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 随包发的静态资源：three.js（画地球）与两张 NASA 贴图。
 * 贴图来自 three-globe 项目的示例图（MIT 仓库 / NASA Visible Earth，公有领域）。
 */
const ASSETS = {
  '/dsh-finance/three.module.js': [join(PLUGIN_ROOT, 'vendor', 'three.module.js'), 'text/javascript; charset=utf-8'],
  '/dsh-finance/globe.js': [join(PLUGIN_ROOT, 'lib', 'globe.js'), 'text/javascript; charset=utf-8'],
  '/dsh-finance/earth-dark.jpg': [join(PLUGIN_ROOT, 'vendor', 'earth-dark.jpg'), 'image/jpeg'],
  '/dsh-finance/earth-topology.png': [join(PLUGIN_ROOT, 'vendor', 'earth-topology.png'), 'image/png'],
}

const DEFAULTS = {
  curl: 'curl.exe',
  proxy: 'http://127.0.0.1:7897',
  base: 'https://query1.finance.yahoo.com/v8/finance/chart',
  timeoutMs: 20000,
  // 标的多了（40+），缓存给长一点，免得一分钟一轮把 Yahoo 惹毛
  cacheTtlMs: 300000,
  refreshMs: 60000,
  range: '1mo',
  interval: '1d',
  maxSymbols: 80,
  sparkPoints: 30,
  colorScheme: 'cn',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) dsh-finance-dock/0.1',
  groups: [],
}

const ROUTE_PING = '/dsh-finance/ping'
const ROUTE_QUOTES = '/dsh-finance/quotes'

/** `${symbol}|${range}|${interval}` → `{ at, quote }`。 */
const cache = new Map()

function localRejection(req) {
  const headers = (req && req.headers) || {}
  const method = String((req && req.method) || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return 405
  if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return 403
  return null
}

function sendJson(res, status, payload) {
  try {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
  } catch {
    /* 连接已经断了 */
  }
}

/** curl 取文本；状态码用 `-w '\n%{http_code}'` 从尾巴切出来。 */
function curlText(url, options) {
  const { proxy, curl = 'curl.exe', timeoutMs = 20000, userAgent } = options || {}
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-finance-'))
  const args = [
    '-sS',
    '-L',
    '--compressed',
    // Yahoo 偶发抽风、本机代理也偶尔抖（实测见过 TLS unexpected eof），给两次重试
    '--retry',
    '2',
    '--retry-delay',
    '1',
    '--retry-connrefused',
    '--max-time',
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
  ]
  if (userAgent) args.push('-A', userAgent)
  args.push('-w', '\n%{http_code}')
  if (proxy) args.push('-x', String(proxy))
  args.push(url)
  return new Promise((resolve) => {
    execFile(
      curl,
      args,
      { timeout: timeoutMs + 5000, windowsHide: true, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        try {
          rmSync(scratch, { recursive: true, force: true })
        } catch {
          /* gone */
        }
        const raw = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout || '')
        const match = /\n(\d{3})\s*$/.exec(raw)
        resolve({
          status: match ? Number(match[1]) : 0,
          content: match ? raw.slice(0, match.index) : raw,
          error: error ? `curl 退出码 ${error.code ?? '?'}：${String(error.message || error).slice(0, 200)}` : undefined,
        })
      },
    )
  })
}

/** Yahoo 的响应 → 客户端要的最小形状。 */
function normalizeQuote(symbol, payload, opts) {
  const result = payload && payload.chart && Array.isArray(payload.chart.result) ? payload.chart.result[0] : null
  if (!result) return null
  const meta = result.meta || {}
  const closes = ((result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [])
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
  // ⚠️ 坑：range=1mo 时 meta.chartPreviousClose 是「一个月前」的收盘，不是昨收 ——
  // 拿它算出来的是月涨跌（实测 ^N225 会显示 +6%）。Yahoo 这个响应里**没有**
  // previousClose 字段，真正的昨收是收盘序列的倒数第二个点。
  const last = closes[closes.length - 1]
  const prev = closes[closes.length - 2]
  const price = Number.isFinite(Number(meta.regularMarketPrice)) ? Number(meta.regularMarketPrice) : last
  const prevClose = Number.isFinite(prev) ? prev : Number(meta.chartPreviousClose)
  const change = price - prevClose
  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    currency: meta.currency || '',
    exchange: meta.exchangeName || '',
    price,
    prevClose,
    change,
    changePct: prevClose ? (change / prevClose) * 100 : 0,
    spark: closes.slice(-(opts.sparkPoints || 30)),
    asOf: meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now(),
  }
}

async function quoteFor(symbol, opts) {
  const key = `${symbol}|${opts.range}|${opts.interval}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < opts.cacheTtlMs) return hit.quote
  const url = `${String(opts.base).replace(/\/+$/, '')}/${encodeURIComponent(symbol)}?range=${encodeURIComponent(opts.range)}&interval=${encodeURIComponent(opts.interval)}`
  const result = await curlText(url, opts)
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`HTTP ${result.status} ${String(result.content || result.error).slice(0, 120)}`)
  }
  let payload
  try {
    payload = JSON.parse(result.content)
  } catch {
    throw new Error(`返回不是 JSON：${String(result.content).slice(0, 120)}`)
  }
  const quote = normalizeQuote(symbol, payload, opts)
  if (!quote) throw new Error('响应里没有 chart.result')
  cache.set(key, { at: Date.now(), quote })
  return quote
}

/** 监视列表里出现过的所有 symbol（去重、保序）。 */
function configuredSymbols(opts) {
  const out = []
  for (const group of opts.groups || []) {
    for (const item of (group && group.items) || []) {
      const symbol = String((item && item.symbol) || '').trim()
      if (symbol && !out.includes(symbol)) out.push(symbol)
    }
  }
  return out
}

/** 限流并发：一次最多 n 个请求，别把本机代理和 Yahoo 一起惹毛。 */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      out[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return out
}

/** Host plugin body: two same-origin routes. */
function apply(ctx, config) {
  const cfg = config && typeof config === 'object' ? config : {}
  const opts = { ...DEFAULTS, ...cfg }
  if (!Array.isArray(opts.groups) || !opts.groups.length) opts.groups = DEFAULTS.groups

  ctx.inject(['webServer'], (scoped) => {
    const disposers = []

    // 静态资源：three.js 与地球贴图（一次读进内存，随包发，不依赖 CDN）
    for (const [route, [file, type]] of Object.entries(ASSETS)) {
      disposers.push(
        scoped.webServer.register({
          kind: 'exact',
          path: route,
          handler: (req, res) => {
            try {
              const body = readFileSync(file)
              res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=86400', 'content-length': body.length })
              res.end(body)
            } catch (error) {
              res.statusCode = 404
              res.end(String((error && error.message) || error))
            }
          },
        }),
      )
    }
    const guard = (handler) => (req, res) => {
      const rejection = localRejection(req)
      if (rejection !== null) {
        try {
          res.statusCode = rejection
          res.end()
        } catch {
          /* closed */
        }
        return
      }
      Promise.resolve(handler(req, res)).catch((error) => {
        sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      })
    }

    disposers.push(
      scoped.webServer.register({
        kind: 'exact',
        path: ROUTE_PING,
        handler: guard((req, res) =>
          sendJson(res, 200, {
            ok: true,
            refreshMs: opts.refreshMs,
            colorScheme: opts.colorScheme,
            range: opts.range,
            interval: opts.interval,
            groups: opts.groups,
          }),
        ),
      }),
    )

    disposers.push(
      scoped.webServer.register({
        kind: 'exact',
        path: ROUTE_QUOTES,
        handler: guard(async (req, res) => {
          const query = new URL(req.url || '/', 'http://127.0.0.1').searchParams
          const asked = String(query.get('symbols') || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
          const symbols = (asked.length ? asked : configuredSymbols(opts)).slice(0, opts.maxSymbols)
          if (!symbols.length) {
            sendJson(res, 400, { ok: false, error: '没有要取的 symbol（配置里 groups 为空，也没传 symbols）' })
            return
          }
          const settled = await mapLimit(symbols, 4, async (symbol) => {
            try {
              return { ok: true, quote: await quoteFor(symbol, opts) }
            } catch (error) {
              return { ok: false, symbol, error: String((error && error.message) || error) }
            }
          })
          sendJson(res, 200, {
            ok: true,
            updatedAt: Date.now(),
            quotes: settled.filter((item) => item.ok).map((item) => item.quote),
            errors: settled.filter((item) => !item.ok).map((item) => ({ symbol: item.symbol, error: item.error })),
          })
        }),
      }),
    )

    ctx.on('dispose', () => {
      for (const off of disposers) {
        try {
          off()
        } catch {
          /* already gone */
        }
      }
    })
  })
}

export { apply, configuredSymbols, normalizeQuote, curlText, ROUTE_PING, ROUTE_QUOTES, DEFAULTS }
