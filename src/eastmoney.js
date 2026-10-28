// 数据源编排：东方财富为主，不可达时降级到新浪 / 腾讯。
//
// 背景（2026-10 实测）：本机只有 push2 系域名（push2 / push2his）不可达，
// 同域的 quote / datacenter-web / push2ex 均正常。所以这里做两件事：
//   1) 东财失败即熔断 5 分钟，期间不再白等超时，直接走备用源；
//   2) 每个对外函数都保证「要么给出数据，要么给出可读的中文错误」。
// 所有真正的外发请求都经过 waitRequestSlot()（串行 + ≥1s 间隔 + 抖动），避免触发风控。
import { getJson } from './http.js'
import { waitRequestSlot } from './net.js'
import { quote as tencentQuote } from './tencent.js'
import { runAkshare } from './akshare.js'
import {
  screenTop as sinaScreenTop,
  sectorList as sinaSectorList,
  stockFlow as sinaStockFlow,
} from './sina.js'

const REFERER = 'https://quote.eastmoney.com/'

// 只保留两个：全部不可达时靠熔断 + 降级源，不再逐个试死域名。
const PUSH2_HOSTS = ['push2.eastmoney.com', 'push2delay.eastmoney.com']
let preferredHost = 0

const DOWN_COOLDOWN_MS = 5 * 60 * 1000
let eastmoneyDownUntil = 0

function eastmoneyAvailable() {
  return Date.now() >= eastmoneyDownUntil
}

function markEastmoneyDown(error) {
  if (error && error.code === 'EASTMONEY_UNREACHABLE' && Date.now() >= eastmoneyDownUntil) {
    eastmoneyDownUntil = Date.now() + DOWN_COOLDOWN_MS
    console.warn(`[dsh-fire-stock] 东财 push2 不可达，${DOWN_COOLDOWN_MS / 60000} 分钟内直接走备用源`)
  }
}

/** 依次尝试 push2 域名（串行，每跳之间过限流），返回第一个成功的 JSON。 */
async function push2Get(path, { timeoutMs = 6000 } = {}) {
  const failures = []
  for (let i = 0; i < PUSH2_HOSTS.length; i++) {
    const index = (preferredHost + i) % PUSH2_HOSTS.length
    const host = PUSH2_HOSTS[index]
    await waitRequestSlot()
    try {
      const json = await getJson(`https://${host}${path}`, {
        headers: { Referer: REFERER },
        timeoutMs,
        retries: 0,
      })
      if (index !== preferredHost) {
        preferredHost = index
        console.log(`[dsh-fire-stock] 东财行情域名切换为 ${host}`)
      }
      return json
    } catch (e) {
      failures.push(`${host}: ${e?.message ?? e}`)
    }
  }
  const err = new Error(`东方财富行情接口不可达（已尝试 ${PUSH2_HOSTS.length} 个域名）：${failures.join('；')}`)
  err.code = 'EASTMONEY_UNREACHABLE'
  throw err
}

/** 主源失败、备用源也失败时的统一错误（保留两边原因，便于判断是网络还是代码）。 */
function unavailable(what, primaryError, fallbackError) {
  const parts = []
  if (primaryError) parts.push(`东财：${primaryError.message}`)
  if (fallbackError) parts.push(`备用源：${fallbackError.message}`)
  const err = new Error(`${what}获取失败（${parts.join('；')}）`)
  err.code = 'DATA_SOURCE_UNAVAILABLE'
  return err
}

/** 股票代码 → 东财 secid（沪市 6→1，其余→0）。 */
export function secidOf(code) {
  const c = String(code).trim()
  return (c.startsWith('6') ? '1.' : '0.') + c
}

// ---------- 实时行情 ----------
const QUOTE_FIELDS = 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f162,f167,f168,f169,f170,f171,f116,f117'

async function quoteFromEastmoney(code) {
  const j = await push2Get(`/api/qt/stock/get?secid=${secidOf(code)}&fltt=2&invt=2&fields=${QUOTE_FIELDS}`, {
    timeoutMs: 2500,
  })
  const d = j && j.data
  if (!d || d.f57 === '-') throw new Error(`未找到股票代码 ${code}`)
  return {
    code: d.f57,
    name: d.f58,
    price: d.f43,
    open: d.f46,
    high: d.f44,
    low: d.f45,
    prevClose: d.f60,
    change: d.f169,
    changePct: d.f170,
    amplitude: d.f171,
    volume: d.f47,
    amount: d.f48,
    turnover: d.f168,
    pe: d.f162,
    pb: d.f167,
    totalMv: d.f116,
    floatMv: d.f117,
    source: 'eastmoney',
  }
}

/**
 * 实时行情：东财优先，不可达时回退腾讯（腾讯字段齐全，保真度无损失）。
 * @param {string} code 6 位股票代码
 */
export async function quote(code) {
  const c = String(code).trim()
  if (eastmoneyAvailable()) {
    try {
      return await quoteFromEastmoney(c)
    } catch (e) {
      markEastmoneyDown(e)
    }
  }
  try {
    return await tencentQuote(c)
  } catch (tencentError) {
    const err = new Error(
      `获取 ${c} 行情失败：东财 push2 不可达，腾讯源也不可用（${tencentError?.message ?? tencentError}）`,
    )
    err.code = 'QUOTE_UNAVAILABLE'
    throw err
  }
}

// ---------- 板块排名 / 资金流 ----------
const SECTOR_TYPE = { industry: '2', concept: '3', region: '1' }
const SECTOR_FIELDS = 'f3,f12,f14,f62,f104,f105'

async function sectorFromEastmoney({ type = 'industry', sort = 'pct', limit = 20 } = {}) {
  const t = SECTOR_TYPE[type] || '2'
  const fid = sort === 'flow' ? 'f62' : 'f3'
  const j = await push2Get(
    `/api/qt/clist/get?pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=${fid}&fs=m:90+t:${t}&fields=${SECTOR_FIELDS}`,
  )
  const list = (j && j.data && j.data.diff) || []
  return list.map((d) => ({
    code: d.f12,
    name: d.f14,
    changePct: d.f3,
    mainNetInflow: d.f62,
    upCount: d.f104,
    downCount: d.f105,
    source: 'eastmoney',
  }))
}

/**
 * 同花顺板块数据（经 akshare 子进程）：东财之外唯一同时给出「涨跌幅 + 主力净流入」的免费源，
 * 分类也比新浪细（行业 90 / 概念 387，新浪是 49 / 175）。
 */
async function thsSectorList({ type = 'industry', sort = 'pct', limit = 20 } = {}) {
  if (type !== 'industry' && type !== 'concept') {
    const err = new Error(`同花顺备用源没有「${type}」板块数据（只支持 industry / concept）`)
    err.code = 'THS_UNSUPPORTED'
    throw err
  }
  const rows = await runAkshare('sector_flow', { type, period: '即时' }, 20000)
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('同花顺板块数据返回为空')
  const key = sort === 'flow' ? 'mainNetInflow' : 'changePct'
  return rows
    .map((r) => ({
      code: '',
      name: r.name,
      changePct: r.changePct,
      mainNetInflow: r.mainNetInflow,
      upCount: null,
      downCount: null,
      companyCount: r.companyCount,
      leadName: r.leadName || '',
      leadPct: r.leadPct,
      source: 'ths',
    }))
    .sort((a, b) => (b[key] == null ? -Infinity : b[key]) - (a[key] == null ? -Infinity : a[key]))
    .slice(0, Math.max(1, Math.min(limit, 100)))
}

/** 主源 + 两个备用源都失败时，把三方原因合成一条可读错误。 */
function allSourcesFailed(primaryError, thsError, sinaError) {
  const reason = (e, label) => `${label}：${e ? e.message : '未尝试'}`
  const err = new Error(
    `板块数据获取失败（${reason(primaryError, '东财')}；${reason(thsError, '同花顺')}；${reason(sinaError, '新浪')}）`,
  )
  err.code = 'DATA_SOURCE_UNAVAILABLE'
  return err
}

/**
 * 行业/概念/地域板块排名。降级顺序：东财 → 同花顺 → 新浪。
 * 同花顺分类更细且带主力净流入，优先；新浪更快、无 Python 依赖，做最后保底。
 * region（地域板块）只有东财提供。
 * @param {object} opts { type, sort, limit }
 */
export async function sectorList(opts = {}) {
  const { type = 'industry', sort = 'pct', limit = 20 } = opts
  let primaryError = null
  if (eastmoneyAvailable()) {
    try {
      return await sectorFromEastmoney({ type, sort, limit })
    } catch (e) {
      primaryError = e
      markEastmoneyDown(e)
    }
  }
  // region：两个备用源都没有，不必白跑两趟。
  if (type !== 'industry' && type !== 'concept') {
    throw allSourcesFailed(
      primaryError,
      new Error(`同花顺备用源没有「${type}」板块`),
      new Error(`新浪备用源没有「${type}」板块`),
    )
  }
  let thsError = null
  try {
    return await thsSectorList({ type, sort, limit })
  } catch (e) {
    thsError = e
  }
  try {
    return await sinaSectorList({ type, sort, limit })
  } catch (sinaError) {
    throw allSourcesFailed(primaryError, thsError, sinaError)
  }
}

// ---------- 涨停板池（push2ex，实测可用） ----------
const ZT_BASE = 'https://push2ex.eastmoney.com'

export async function limitUpPool({ date, limit = 100 } = {}) {
  const d = date || recentTradingDate()
  let lastErr = null
  // 当天可能尚未开板或为空，向前回溯最多 20 个自然日找一个非空交易日。
  for (let i = 0; i < 20; i++) {
    const day = shiftDate(d, -i)
    const url = `${ZT_BASE}/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=${limit}&sort=fbt%3Aasc&date=${day}`
    await waitRequestSlot()
    try {
      const j = await getJson(url, { headers: { Referer: REFERER }, timeoutMs: 6000, retries: 0 })
      const pool = (j && j.data && j.data.pool) || []
      if (pool.length > 0) {
        return {
          date: day,
          total: pool.length,
          pool: pool.map((p) => ({
            code: p.c,
            name: p.n,
            price: p.p != null ? +(p.p / 1000).toFixed(2) : null,
            changePct: p.zdp != null ? +Number(p.zdp).toFixed(2) : null,
            streak: p.lbc,
            firstSeal: fmtSealTime(p.fbt),
            lastSeal: fmtSealTime(p.lbt),
            sealAmount: p.fund,
            breakCount: p.zbc,
            industry: p.hybk,
            source: 'eastmoney',
          })),
        }
      }
    } catch (e) {
      lastErr = e
    }
  }
  if (lastErr) throw new Error(`涨停板池接口不可达：${lastErr?.message ?? lastErr}`)
  return { date: d, total: 0, pool: [] }
}

// ---------- 交易日辅助 ----------
export function recentTradingDate() {
  let dt = new Date()
  for (let i = 0; i < 7; i++) {
    const day = dt.getDay()
    if (day !== 0 && day !== 6) return toYmd(dt)
    dt = new Date(dt.getTime() - 86400000)
  }
  return toYmd(new Date())
}

export function lastTradingDates(count = 7) {
  const out = []
  const dt = new Date()
  while (out.length < count) {
    const day = dt.getDay()
    if (day !== 0 && day !== 6) out.push(toYmd(dt))
    dt.setDate(dt.getDate() - 1)
  }
  return out
}

function toYmd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function shiftDate(ymd, days) {
  const y = Number(ymd.slice(0, 4))
  const m = Number(ymd.slice(4, 6)) - 1
  const d = Number(ymd.slice(6, 8))
  const dt = new Date(y, m, d)
  dt.setDate(dt.getDate() + days)
  return toYmd(dt)
}

// 封板时间 HHMMSS（如 92500）→ HH:MM:SS。
function fmtSealTime(v) {
  if (v == null) return ''
  const s = String(v).padStart(6, '0')
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`
}

// ---------- 个股资金流 ----------
async function flowFromEastmoney(code, days) {
  const j = await push2Get(
    `/api/qt/stock/fflow/kline/get?lmt=${Math.max(1, Math.min(days, 60))}&klt=101&secid=${secidOf(code)}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56`,
  )
  const d = j && j.data
  if (!d || !Array.isArray(d.klines) || d.klines.length === 0) throw new Error(`未获取到 ${code} 的资金流`)
  // kline 字段序：日期, 主力, 小单, 中单, 大单, 超大单（净流入）
  const list = d.klines
    .map((k) => {
      const [date, main, small, medium, large, superLarge] = k.split(',')
      return {
        date,
        main: Number(main),
        small: Number(small),
        medium: Number(medium),
        large: Number(large),
        superLarge: Number(superLarge),
      }
    })
    .reverse()
  const totalMain = list.reduce((s, x) => s + (x.main || 0), 0)
  return { code: d.code, name: d.name, totalMain, latest: list[list.length - 1], list, source: 'eastmoney' }
}

/**
 * 个股资金流：东财给历史序列；不可达时降级到新浪（仅最近一日主力净流入）。
 * @param {string} code 6 位股票代码
 * @param {number} days 返回近 N 个交易日
 */
export async function stockFlow(code, days = 10) {
  const c = String(code).trim()
  let primaryError = null
  if (eastmoneyAvailable()) {
    try {
      return await flowFromEastmoney(c, days)
    } catch (e) {
      primaryError = e
      markEastmoneyDown(e)
    }
  }
  try {
    return await sinaStockFlow(c, days)
  } catch (fallbackError) {
    throw unavailable('个股资金流', primaryError, fallbackError)
  }
}

// ---------- 全市场排序扫描 ----------
const FULL_MARKET = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
const SCAN_FIELDS = 'f2,f3,f5,f6,f8,f9,f10,f12,f14,f20,f23,f62,f100'
const SCAN_FID = {
  changePct: 'f3',
  turnover: 'f8',
  pe: 'f9',
  pb: 'f23',
  mainInflow: 'f62',
  totalMv: 'f20',
  volumeRatio: 'f10',
}

async function screenFromEastmoney({ sortBy = 'changePct', order = 'desc', limit = 100 } = {}) {
  const fid = SCAN_FID[sortBy] || 'f3'
  const po = order === 'asc' ? 0 : 1
  const j = await push2Get(
    `/api/qt/clist/get?pn=1&pz=${Math.min(Math.max(limit, 1), 100)}&po=${po}&np=1&fltt=2&invt=2&fid=${fid}&fs=${FULL_MARKET}&fields=${SCAN_FIELDS}`,
    { timeoutMs: 8000 },
  )
  return ((j && j.data && j.data.diff) || []).map(normalizeScanRow)
}

/**
 * 按某字段对全市场排序并取前 N 名。东财不可达时降级新浪（缺主力净流入/行业/量比）。
 * @param {object} opts { sortBy, order, limit }
 */
export async function screenTop(opts = {}) {
  const { sortBy = 'changePct', order = 'desc', limit = 100 } = opts
  let primaryError = null
  if (eastmoneyAvailable()) {
    try {
      return await screenFromEastmoney({ sortBy, order, limit })
    } catch (e) {
      primaryError = e
      markEastmoneyDown(e)
    }
  }
  try {
    return await sinaScreenTop({ sortBy, order, limit })
  } catch (fallbackError) {
    throw unavailable('选股数据', primaryError, fallbackError)
  }
}

export function normalizeScanRow(d) {
  const num = (v) => (v === '-' || v == null || Number.isNaN(Number(v)) ? null : Number(v))
  return {
    code: d.f12,
    name: d.f14,
    price: num(d.f2),
    changePct: num(d.f3),
    volume: num(d.f5),
    amount: num(d.f6),
    turnover: num(d.f8),
    pe: num(d.f9),
    volumeRatio: num(d.f10),
    totalMv: num(d.f20),
    pb: num(d.f23),
    mainInflow: num(d.f62),
    industry: d.f100,
    source: 'eastmoney',
  }
}
