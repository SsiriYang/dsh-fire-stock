// 腾讯行情接口：qt.gtimg.cn 实时报价（GBK 文本），作为东财 push2 不可达时的兜底源。
import { getJson, getText } from './http.js'

const QUOTE_BASE = 'https://qt.gtimg.cn/q='

/** 代码 → 交易所前缀（沪 sh / 深 sz / 北 bj）。 */
export function marketPrefix(code) {
  const c = String(code).trim()
  if (c.startsWith('6')) return 'sh'
  if (c.startsWith('8') || c.startsWith('4') || c.startsWith('9')) return 'bj'
  return 'sz'
}

const SCALE = { day: 'day', week: 'week', month: 'month', m1: 'm1', m5: 'm5', m15: 'm15', m30: 'm30', m60: 'm60' }
const KLINE_BASE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'

/**
 * 拉取 K 线。
 * @param {string} code 股票代码
 * @param {object} opts { period: 'day'|'week'|'month'|'m1'|'m5'|..., count, fq: 'qfq'|'hfq'|'none' }
 */
export async function kline(code, { period = 'day', count = 120, fq = 'qfq' } = {}) {
  const sym = marketPrefix(code) + code
  const scale = SCALE[period] || 'day'
  const isLong = scale === 'day' || scale === 'week' || scale === 'month'
  const fqParam = isLong ? (fq || 'qfq') : ''
  const param = `${sym},${scale},,,${count},${fqParam}`
  const j = await getJson(`${KLINE_BASE}?param=${encodeURIComponent(param)}`, {
    headers: { Referer: 'https://gu.qq.com/' },
  })
  const node = j && j.data && j.data[sym]
  if (!node) throw new Error(`未获取到 ${code} 的 K 线`)
  let key = scale
  if (isLong) key = fq === 'hfq' ? 'hfq' + scale : fq === 'none' ? scale : 'qfq' + scale
  const rows = node[key] || node[scale] || []
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`未获取到 ${code} 的 K 线`)
  return rows.map((r) => ({
    date: r[0],
    open: Number(r[1]),
    close: Number(r[2]),
    high: Number(r[3]),
    low: Number(r[4]),
    volume: Number(r[5]),
  }))
}

/**
 * 腾讯实时行情，字段与东财 quote() 对齐：
 * name/code/price/open/high/low/prevClose/change/changePct/amplitude/volume/amount/turnover/pe/pb/totalMv/floatMv
 * 金额统一为「元」，市值统一为「元」。
 * @param {string} code 6 位股票代码
 */
export async function quote(code) {
  const c = String(code).trim()
  const sym = marketPrefix(c) + c
  const text = await getText(`${QUOTE_BASE}${sym}`, {
    headers: { Referer: 'https://gu.qq.com/' },
    encoding: 'gbk',
    timeoutMs: 8000,
  })
  const m = /="([^"]*)"/.exec(text)
  if (!m) throw new Error(`未找到股票代码 ${c}`)
  const f = m[1].split('~')
  if (f.length < 50 || !f[1]) throw new Error(`未找到股票代码 ${c}`)
  const num = (i) => {
    const v = Number(f[i])
    return f[i] === '' || f[i] == null || Number.isNaN(v) ? null : v
  }
  const amountWan = num(37) // 成交额（万元）
  const floatMvYi = num(44) // 流通市值（亿元）
  const totalMvYi = num(45) // 总市值（亿元）
  return {
    code: f[2] || c,
    name: f[1],
    price: num(3),
    open: num(5),
    high: num(33),
    low: num(34),
    prevClose: num(4),
    change: num(31),
    changePct: num(32),
    amplitude: num(43),
    volume: num(6),
    amount: amountWan == null ? null : amountWan * 1e4,
    turnover: num(38),
    pe: num(39),
    pb: num(46),
    totalMv: totalMvYi == null ? null : totalMvYi * 1e8,
    floatMv: floatMvYi == null ? null : floatMvYi * 1e8,
    source: 'tencent',
  }
}
