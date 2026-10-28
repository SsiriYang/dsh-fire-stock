// 东方财富免费 JSON 接口：实时行情 / 板块排名与资金流 / 涨停板池。
import { getJson } from './http.js'

const BASE = 'https://push2.eastmoney.com'
const REFERER = 'https://quote.eastmoney.com/'

/** 股票代码 → 东财 secid（沪市 6→1，其余→0）。 */
export function secidOf(code) {
  const c = String(code).trim()
  return (c.startsWith('6') ? '1.' : '0.') + c
}

// 东财实时行情字段（fltt=2 时价格为实际小数，无需再除 100）。
const QUOTE_FIELDS = 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f162,f167,f168,f169,f170,f171,f116,f117'

export async function quote(code) {
  const url = `${BASE}/api/qt/stock/get?secid=${secidOf(code)}&fltt=2&invt=2&fields=${QUOTE_FIELDS}`
  const j = await getJson(url, { headers: { Referer: REFERER } })
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
  }
}

// 板块类型 → 东财 fs 参数：行业(2) / 概念(3) / 地域(1)。
const SECTOR_TYPE = { industry: '2', concept: '3', region: '1' }
const SECTOR_FIELDS = 'f3,f12,f14,f62,f104,f105'

export async function sectorList({ type = 'industry', sort = 'pct', limit = 20 } = {}) {
  const t = SECTOR_TYPE[type] || '2'
  const fid = sort === 'flow' ? 'f62' : 'f3'
  const url = `${BASE}/api/qt/clist/get?pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=${fid}&fs=m:90+t:${t}&fields=${SECTOR_FIELDS}`
  const j = await getJson(url, { headers: { Referer: REFERER } })
  const list = (j && j.data && j.data.diff) || []
  return list.map((d) => ({
    code: d.f12,
    name: d.f14,
    changePct: d.f3,
    mainNetInflow: d.f62,
    upCount: d.f104,
    downCount: d.f105,
  }))
}

const ZT_BASE = 'https://push2ex.eastmoney.com'

export async function limitUpPool({ date, limit = 100 } = {}) {
  const d = date || recentTradingDate()
  // 当天可能尚未开板或为空，向前回溯最多 20 个自然日找一个非空交易日。
  for (let i = 0; i < 20; i++) {
    const day = shiftDate(d, -i)
    const url = `${ZT_BASE}/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=${limit}&sort=fbt%3Aasc&date=${day}`
    const j = await getJson(url, { headers: { Referer: REFERER } })
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
        })),
      }
    }
  }
  return { date: d, total: 0, pool: [] }
}

// 最近一个交易日的 YYYYMMDD（今天起，跳过周末）。
export function recentTradingDate() {
  let dt = new Date()
  for (let i = 0; i < 7; i++) {
    const day = dt.getDay()
    if (day !== 0 && day !== 6) return toYmd(dt)
    dt = new Date(dt.getTime() - 86400000)
  }
  return toYmd(new Date())
}

// 最近 N 个交易日（YYYYMMDD，从今天回溯，跳过周末）。
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

// ---------- 个股资金流（push2 fflow，历史日线） ----------
export async function stockFlow(code, days = 10) {
  const url = `${BASE}/api/qt/stock/fflow/kline/get?lmt=${Math.max(1, Math.min(days, 60))}&klt=101&secid=${secidOf(code)}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56`
  const j = await getJson(url, { headers: { Referer: REFERER } })
  const d = j && j.data
  if (!d || !Array.isArray(d.klines) || d.klines.length === 0) throw new Error(`未获取到 ${code} 的资金流`)
  // kline 字段序：日期, 主力, 小单, 中单, 大单, 超大单（净流入）
  const list = d.klines.map((k) => {
    const [date, main, small, medium, large, superLarge] = k.split(',')
    return {
      date,
      main: Number(main),
      small: Number(small),
      medium: Number(medium),
      large: Number(large),
      superLarge: Number(superLarge),
    }
  }).reverse()
  const totalMain = list.reduce((s, x) => s + (x.main || 0), 0)
  return { code: d.code, name: d.name, totalMain, latest: list[list.length - 1], list }
}

// ---------- 全市场排序扫描（服务端排序，单请求取前 N 名） ----------
const FULL_MARKET = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
const SCAN_FIELDS = 'f2,f3,f5,f6,f8,f9,f10,f12,f14,f20,f23,f62,f100'
const SCAN_FID = {
  changePct: 'f3', turnover: 'f8', pe: 'f9', pb: 'f23',
  mainInflow: 'f62', totalMv: 'f20', volumeRatio: 'f10',
}

/**
 * 按某字段对全市场排序并取前 N 名（单请求，避免分页触发接口限流）。
 * @param {object} opts { sortBy, order, limit }
 */
export async function screenTop({ sortBy = 'changePct', order = 'desc', limit = 100 } = {}) {
  const fid = SCAN_FID[sortBy] || 'f3'
  const po = order === 'asc' ? 0 : 1
  const url = `${BASE}/api/qt/clist/get?pn=1&pz=${Math.min(Math.max(limit, 1), 100)}&po=${po}&np=1&fltt=2&invt=2&fid=${fid}&fs=${FULL_MARKET}&fields=${SCAN_FIELDS}`
  const j = await getJson(url, { headers: { Referer: REFERER }, retries: 2 })
  return ((j && j.data && j.data.diff) || []).map(normalizeScanRow)
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
  }
}
