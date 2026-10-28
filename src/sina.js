// 新浪财经备用源：东财 push2 不可达时接管行情 / 板块 / 选股 / 资金流。
// 注意保真度差异（已在工具描述里注明）：
//   - 选股：无「主力净流入」与「所属行业」，无「量比」
//   - 板块：无「主力净流入」与「上涨/下跌家数」，但多给领涨股
//   - 资金流：只有最近一个交易日的主力净流入，没有历史序列
import { getJson, getText } from './http.js'
import { waitRequestSlot } from './net.js'
import { marketPrefix } from './tencent.js'

// 伪装成浏览器：真实 UA + 新浪站内 Referer（新浪对空 Referer 直接 403）。
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Referer: 'https://finance.sina.com.cn/',
  Accept: '*/*',
}

const TIMEOUT_MS = 8000

// 工具里的排序字段 → 新浪接口的 sort 参数。
const MARKET_SORT = {
  changePct: 'changepercent',
  turnover: 'turnoverratio',
  pe: 'per',
  pb: 'pb',
  totalMv: 'mktcap',
}

function num(v) {
  const n = Number(v)
  return v === '' || v == null || Number.isNaN(n) ? null : n
}

/**
 * 全市场排序取前 N 名（新浪 Market_Center）。
 * @param {object} opts { sortBy, order, limit }
 */
export async function screenTop({ sortBy = 'changePct', order = 'desc', limit = 100 } = {}) {
  const sort = MARKET_SORT[sortBy]
  if (!sort) {
    const err = new Error(
      `新浪备用源不支持按「${sortBy}」排序（只支持 changePct / turnover / pe / pb / totalMv）`,
    )
    err.code = 'SINA_UNSUPPORTED'
    throw err
  }
  const asc = order === 'asc' ? 1 : 0
  const count = Math.min(Math.max(limit, 1), 100)
  const url =
    'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData' +
    `?page=1&num=${count}&sort=${sort}&asc=${asc}&node=hs_a&symbol=&_s_r_a=page`
  await waitRequestSlot()
  const rows = await getJson(url, { headers: HEADERS, timeoutMs: TIMEOUT_MS })
  if (!Array.isArray(rows)) throw new Error('新浪选股接口返回异常（非数组）')
  return rows.map((r) => {
    const volumeShares = num(r.volume)
    const mktcapWan = num(r.mktcap)
    return {
      code: r.code,
      name: r.name,
      price: num(r.trade),
      changePct: num(r.changepercent),
      // 东财 f5 是「手」，这里从「股」换算成「手」，保持两个源的字段语义一致。
      volume: volumeShares == null ? null : volumeShares / 100,
      amount: num(r.amount),
      turnover: num(r.turnoverratio),
      pe: num(r.per),
      volumeRatio: null,
      totalMv: mktcapWan == null ? null : mktcapWan * 1e4,
      pb: num(r.pb),
      mainInflow: null,
      industry: null,
      source: 'sina',
    }
  })
}

const SECTOR_URLS = {
  industry: 'https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php',
  concept: 'https://money.finance.sina.com.cn/q/view/newFLJK.php?param=class',
}

/**
 * 行业 / 概念板块涨跌幅排名（新浪）。
 * 每条记录格式：代码,名称,家数,均价,涨跌额,涨跌幅,成交量,成交额,领涨股代码,领涨股涨幅,领涨股价,领涨股涨跌额,领涨股名
 * @param {object} opts { type, sort, limit }
 */
export async function sectorList({ type = 'industry', sort = 'pct', limit = 20 } = {}) {
  const url = SECTOR_URLS[type]
  if (!url) {
    const err = new Error(`新浪备用源没有「${type}」板块数据（只支持 industry / concept）`)
    err.code = 'SINA_UNSUPPORTED'
    throw err
  }
  if (sort === 'flow') {
    const err = new Error('板块主力净流入只有东方财富 push2 提供，新浪板块接口没有资金流数据')
    err.code = 'SINA_UNSUPPORTED'
    throw err
  }
  await waitRequestSlot()
  const text = await getText(url, { headers: HEADERS, encoding: 'gbk', timeoutMs: TIMEOUT_MS })
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')
  if (from < 0 || to <= from) throw new Error('新浪板块接口返回格式异常')
  let parsed
  try {
    parsed = JSON.parse(text.slice(from, to + 1))
  } catch {
    throw new Error('新浪板块数据解析失败')
  }
  const list = Object.values(parsed)
    .map((raw) => {
      const p = String(raw).split(',')
      return {
        code: p[0],
        name: p[1],
        changePct: num(p[5]),
        mainNetInflow: null,
        upCount: null,
        downCount: null,
        leadName: p[12] || '',
        leadPct: num(p[9]),
        source: 'sina',
      }
    })
    .filter((s) => s.name && s.changePct != null)
  list.sort((a, b) => b.changePct - a.changePct)
  return list.slice(0, Math.max(1, Math.min(limit, 100)))
}

/**
 * 个股资金流（新浪，仅最近一个交易日的主力净流入）。
 * @param {string} code 6 位股票代码
 */
export async function stockFlow(code, _days = 1) {
  const c = String(code).trim()
  const sym = marketPrefix(c) + c
  await waitRequestSlot()
  const j = await getJson(
    `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssi_ssfx_flzjtj?daima=${sym}`,
    { headers: HEADERS, timeoutMs: TIMEOUT_MS },
  )
  const main = num(j && j.netamount)
  if (main == null) throw new Error(`未获取到 ${c} 的资金流`)
  const row = {
    date: new Date().toISOString().slice(0, 10),
    main,
    superLarge: null,
    large: null,
    medium: null,
    small: null,
  }
  return {
    code: c,
    name: (j && j.name) || c,
    totalMain: main,
    latest: row,
    list: [row],
    source: 'sina',
    note: '东方财富资金流接口不可达，已降级为新浪源：仅提供最近一个交易日的主力净流入（其余档位与历史序列不可得）。',
  }
}
