// 股性识别 + 策略匹配（纯函数，基于日线 K 线）。
// 思路：用量化特征（趋势拟合 R²、波动率、收益自相关、均线多头占比、回撤、布林带宽）
// 把个股归为 趋势型 / 波段型 / 震荡型，再对 6 种策略打分，推荐匹配度最高的若干种，
// 并直接跑简化回测给出对比结果 —— 沉淀自实测「股性 × 策略」规律：
// 强趋势股适配均线/MACD/突破，震荡股适配 RSI 超卖反弹/布林回归。
import * as ind from './indicators.js'
import { backtest } from './quant.js'

const STRATEGY_META = {
  ma_cross: { name: '均线金叉/死叉', family: 'trend' },
  macd_cross: { name: 'MACD 金叉/死叉', family: 'trend' },
  kdj_cross: { name: 'KDJ 金叉/死叉', family: 'swing' },
  breakout: { name: 'N日突破', family: 'trend' },
  rsi_reversal: { name: 'RSI 超卖反弹', family: 'range' },
  boll_reversal: { name: '布林带回归', family: 'range' },
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * 识别股性并返回推荐策略（含各自回测结果）。
 * @param {Array<{date:string,open:number,close:number,high:number,low:number,volume:number}>} bars
 * @returns 股性指标 + 推荐策略（带回测）
 */
export function stockProfile(bars) {
  if (!Array.isArray(bars) || bars.length < 60) throw new Error('K 线数据不足（至少 60 根）')
  const closes = bars.map((b) => b.close)
  const last = bars.length - 1
  const win = Math.min(bars.length, 120) // 分析窗口：最近 120 根
  const start = bars.length - win
  const wClose = closes.slice(start)
  const rets = []
  for (let i = 1; i < wClose.length; i++) rets.push(wClose[i] / wClose[i - 1] - 1)
  const meanRet = rets.reduce((s, r) => s + r, 0) / rets.length
  const variance = rets.reduce((s, r) => s + (r - meanRet) ** 2, 0) / rets.length
  const volatility = Math.sqrt(variance) * Math.sqrt(250) * 100 // 年化波动率 %

  // 对数价格 vs 时间的线性回归：R² 度量趋势强度，斜率给出方向。
  const ys = wClose.map((c) => Math.log(c))
  const n = ys.length
  const mx = (n - 1) / 2
  const my = ys.reduce((s, y) => s + y, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (i - mx) * (ys[i] - my)
    sxx += (i - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  const slope = sxx > 0 ? sxy / sxx : 0
  const trendR2 = syy > 0 ? clamp(sxy * sxy / (sxx * syy), 0, 1) : 0
  const trendAnnual = slope * 250 * 100 // 年化对数收益 %

  // 收益一阶自相关：为负表示均值回归特征。
  let acNum = 0
  let acDen = 0
  for (let i = 1; i < rets.length; i++) {
    acNum += (rets[i] - meanRet) * (rets[i - 1] - meanRet)
    acDen += (rets[i] - meanRet) ** 2
  }
  const returnAutocorr = acDen > 0 ? acNum / acDen : 0

  // 均线多头时间占比（close > MA20 且 MA20 上行）。
  const ma20 = ind.sma(closes, 20)
  let align = 0
  let alignCount = 0
  for (let i = start + 20; i <= last; i++) {
    if (ma20[i] == null || ma20[i - 1] == null) continue
    alignCount++
    if (closes[i] > ma20[i] && ma20[i] > ma20[i - 1]) align++
  }
  const maAlignment = alignCount > 0 ? align / alignCount : 0

  // 分析窗口内的最大回撤。
  let peak = -Infinity
  let maxDrawdown = 0
  for (const c of wClose) {
    peak = Math.max(peak, c)
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - c) / peak * 100)
  }

  // 布林通道平均带宽（20,2）。
  const { up, low, mid } = ind.boll(closes, 20, 2)
  let bwSum = 0
  let bwCount = 0
  for (let i = start; i <= last; i++) {
    if (up[i] == null || low[i] == null || mid[i] == null || mid[i] <= 0) continue
    bwSum += (up[i] - low[i]) / mid[i]
    bwCount++
  }
  const bollWidth = bwCount > 0 ? bwSum / bwCount * 100 : 0

  const metrics = {
    volatility: +volatility.toFixed(1),
    trendR2: +trendR2.toFixed(3),
    trendAnnual: +trendAnnual.toFixed(1),
    returnAutocorr: +returnAutocorr.toFixed(3),
    maAlignment: +maAlignment.toFixed(2),
    maxDrawdown: +maxDrawdown.toFixed(1),
    bollWidth: +bollWidth.toFixed(1),
  }

  // ---------- 股性归类 ----------
  let label
  let style
  const notes = []
  if (trendR2 >= 0.65) {
    style = 'trend'
    label = trendAnnual >= 0 ? '趋势型（上升趋势）' : '趋势型（下降趋势）'
    notes.push(`近 ${win} 日走势拟合度 R²=${trendR2.toFixed(2)}，方向${trendAnnual >= 0 ? '向上' : '向下'}`)
  } else if (trendR2 >= 0.35) {
    style = 'swing'
    label = '波段型（趋势/震荡交替）'
    notes.push(`走势拟合度 R²=${trendR2.toFixed(2)}，趋势与震荡交替出现`)
  } else {
    style = 'range'
    label = volatility >= 40 ? '高波动震荡型' : '震荡型（区间整理）'
    notes.push(`走势拟合度 R²=${trendR2.toFixed(2)}，无明显方向`)
  }
  if (returnAutocorr < -0.05) notes.push('收益自相关为负，具备均值回归特征')
  if (maAlignment >= 0.6) notes.push(`均线多头时间占比 ${(maAlignment * 100).toFixed(0)}%`)
  else if (maAlignment <= 0.2) notes.push(`均线多头时间占比仅 ${(maAlignment * 100).toFixed(0)}%`)
  if (volatility >= 50) notes.push('波动率偏高')
  else if (volatility <= 20) notes.push('波动率低')

  // ---------- 策略匹配打分 ----------
  const r2 = trendR2
  const vol = volatility
  const volFactor = clamp(vol / 60, 0, 1)
  const scored = [
    { key: 'ma_cross', score: clamp(r2 * 100 + maAlignment * 10, 0, 100), reason: '趋势拟合 + 均线排列打分' },
    { key: 'macd_cross', score: clamp(r2 * 100, 0, 100), reason: 'MACD 跟随趋势，拟合度越高越适配' },
    { key: 'kdj_cross', score: clamp((1 - Math.abs(r2 - 0.45) * 2) * 60 + volFactor * 40, 0, 100), reason: '波段行情中 KDJ 金叉/死叉胜率较高' },
    { key: 'breakout', score: clamp(r2 * 100 + volFactor * 15, 0, 100), reason: '突破策略偏好有方向、有波幅的走势' },
    { key: 'rsi_reversal', score: clamp((1 - r2) * 80 + (returnAutocorr < 0 ? 20 : 0), 0, 100), reason: '震荡 + 均值回归特征下超卖反弹有效' },
    { key: 'boll_reversal', score: clamp((1 - r2) * 85 + (bollWidth >= 10 ? 10 : 0) + (returnAutocorr < 0 ? 5 : 0), 0, 100), reason: '区间行情中布林上下轨回归胜率高' },
  ]
  scored.sort((a, b) => b.score - a.score)
  const recommended = scored.filter((s) => s.score >= 35).slice(0, 3)

  // ---------- 推荐策略回测 ----------
  const strategies = recommended.map((s) => ({
    key: s.key,
    name: STRATEGY_META[s.key].name,
    family: STRATEGY_META[s.key].family,
    score: +s.score.toFixed(0),
    reason: s.reason,
    backtest: backtest(bars, { strategy: s.key }),
  }))

  const family = STRATEGY_META[recommended[0]?.key]?.family ?? style
  const suggestion = family === 'trend'
    ? '该股方向性较强，优先跟随趋势类策略（均线/MACD/突破），注意趋势反转时止损。'
    : family === 'range'
      ? '该股震荡特征明显，优先均值回归类策略（RSI 超卖反弹/布林回归），避免趋势类策略反复打脸。'
      : '该股波段特征明显，趋势与均值回归类策略都可尝试，建议按回测结果取舍。'

  return {
    window: win,
    start: bars[start].date,
    end: bars[last].date,
    character: { style, label, metrics, notes },
    strategies,
    suggestion,
  }
}
