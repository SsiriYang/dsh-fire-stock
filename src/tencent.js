// 腾讯 K 线接口（东财 push2his 主机在本机不可达，改用腾讯稳定源）。
import { getJson } from './http.js'

const BASE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'

/** 代码 → 交易所前缀（沪 sh / 深 sz / 北 bj）。 */
export function marketPrefix(code) {
  const c = String(code).trim()
  if (c.startsWith('6')) return 'sh'
  if (c.startsWith('8') || c.startsWith('4') || c.startsWith('9')) return 'bj'
  return 'sz'
}

const SCALE = { day: 'day', week: 'week', month: 'month', m1: 'm1', m5: 'm5', m15: 'm15', m30: 'm30', m60: 'm60' }

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
  const j = await getJson(`${BASE}?param=${encodeURIComponent(param)}`, {
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
