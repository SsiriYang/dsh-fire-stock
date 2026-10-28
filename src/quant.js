// 量化纯函数：回测引擎 + 策略信号（基于 K 线 + 指标）。
// 支持策略：ma_cross / macd_cross / rsi_reversal / kdj_cross / breakout / boll_reversal。
import * as ind from './indicators.js'

function crossAbove(a, b, i) {
  return i > 0 && a[i] > b[i] && a[i - 1] <= b[i - 1]
}

function crossBelow(a, b, i) {
  return i > 0 && a[i] < b[i] && a[i - 1] >= b[i - 1]
}

function crossAboveValue(values, threshold, i) {
  return i > 0 && values[i] > threshold && values[i - 1] <= threshold
}

function crossBelowValue(values, threshold, i) {
  return i > 0 && values[i] < threshold && values[i - 1] >= threshold
}

/** 生成每日信号数组：'buy' | 'sell' | null。 */
function signalSeries(closes, highs, lows, opts = {}) {
  const { strategy } = opts
  switch (strategy) {
    case 'ma_cross': {
      const a = ind.sma(closes, opts.fast ?? 5)
      const b = ind.sma(closes, opts.slow ?? 20)
      return closes.map((_, i) => {
        if (a[i] == null || b[i] == null) return null
        if (crossAbove(a, b, i)) return 'buy'
        if (crossBelow(a, b, i)) return 'sell'
        return null
      })
    }
    case 'macd_cross': {
      const { dif, dea } = ind.macd(closes)
      return closes.map((_, i) => {
        if (dif[i] == null || dea[i] == null) return null
        if (crossAbove(dif, dea, i)) return 'buy'
        if (crossBelow(dif, dea, i)) return 'sell'
        return null
      })
    }
    case 'rsi_reversal': {
      // 超卖反弹买入（RSI 上穿超卖线），超买回落卖出（RSI 下穿超买线）。
      const period = opts.period ?? 14
      const os = opts.oversold ?? 30
      const ob = opts.overbought ?? 70
      const r = ind.rsi(closes, period)
      return closes.map((_, i) => {
        if (r[i] == null) return null
        if (crossAboveValue(r, os, i)) return 'buy'
        if (crossBelowValue(r, ob, i)) return 'sell'
        return null
      })
    }
    case 'kdj_cross': {
      const { k, d } = ind.kdj(highs, lows, closes, opts.period ?? 9)
      return closes.map((_, i) => {
        if (k[i] == null || d[i] == null) return null
        if (crossAbove(k, d, i)) return 'buy'
        if (crossBelow(k, d, i)) return 'sell'
        return null
      })
    }
    case 'breakout': {
      // N 日突破（唐奇安通道）：收盘突破前 N 日最高价买入，跌破前 N 日最低价卖出。
      const n = opts.period ?? 20
      return closes.map((_, i) => {
        if (i < n) return null
        let hh = -Infinity
        let ll = Infinity
        for (let x = i - n; x < i; x++) {
          hh = Math.max(hh, highs[x])
          ll = Math.min(ll, lows[x])
        }
        if (closes[i] > hh) return 'buy'
        if (closes[i] < ll) return 'sell'
        return null
      })
    }
    case 'boll_reversal': {
      // 布林带均值回归：收盘从下轨下方回到上方买入，从上轨上方回到下方卖出。
      const period = opts.period ?? 20
      const { up, low } = ind.boll(closes, period, 2)
      return closes.map((_, i) => {
        if (up[i] == null || low[i] == null || i === 0) return null
        if (closes[i] > low[i] && closes[i - 1] <= low[i - 1]) return 'buy'
        if (closes[i] < up[i] && closes[i - 1] >= up[i - 1]) return 'sell'
        return null
      })
    }
    default:
      throw new Error(`未知策略 ${strategy}（支持 ma_cross/macd_cross/rsi_reversal/kdj_cross/breakout/boll_reversal）`)
  }
}

/**
 * 简化回测：信号当日收盘价成交，全仓进出，不含手续费/滑点。
 */
export function backtest(bars, opts = {}) {
  const { strategy = 'ma_cross', fast = 5, slow = 20, period, oversold = 30, overbought = 70, initialCapital = 100000 } = opts
  if (!Array.isArray(bars) || bars.length < 40) throw new Error('K 线数据不足（至少 40 根）')
  const closes = bars.map((b) => b.close)
  const highs = bars.map((b) => b.high)
  const lows = bars.map((b) => b.low)
  const PERIOD_DEFAULTS = { rsi_reversal: 14, kdj_cross: 9, breakout: 20, boll_reversal: 20 }
  const effPeriod = PERIOD_DEFAULTS[strategy] !== undefined ? (period ?? PERIOD_DEFAULTS[strategy]) : period
  const sigs = signalSeries(closes, highs, lows, { strategy, fast, slow, period: effPeriod, oversold, overbought })

  let cash = initialCapital
  let shares = 0
  const equityCurve = []
  const trades = []
  for (let i = 0; i < closes.length; i++) {
    const price = closes[i]
    const s = sigs[i]
    if (s === 'buy' && shares === 0 && cash > 0) {
      shares = cash / price
      cash = 0
      trades.push({ type: 'buy', date: bars[i].date, price: +price.toFixed(3) })
    } else if (s === 'sell' && shares > 0) {
      cash = shares * price
      shares = 0
      trades.push({ type: 'sell', date: bars[i].date, price: +price.toFixed(3) })
    }
    equityCurve.push(cash + shares * price)
  }

  const finalEquity = equityCurve[equityCurve.length - 1]
  const totalReturn = (finalEquity / initialCapital - 1) * 100

  let peak = -Infinity
  let maxDrawdown = 0
  for (const e of equityCurve) {
    peak = Math.max(peak, e)
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - e) / peak) * 100)
  }

  // 胜率：完整买入→卖出配对。
  let pairs = 0
  let wins = 0
  for (let t = 1; t < trades.length; t += 2) {
    const buy = trades[t - 1]
    const sell = trades[t]
    if (buy.type === 'buy' && sell.type === 'sell') {
      pairs++
      if (sell.price > buy.price) wins++
    }
  }
  const winRate = pairs > 0 ? (wins / pairs) * 100 : 0

  const periods = closes.length
  const annualized = periods > 0 ? ((Math.pow(finalEquity / initialCapital, 250 / periods) - 1) * 100) : 0

  const params = { initialCapital }
  if (strategy === 'ma_cross') { params.fast = fast; params.slow = slow }
  if (strategy === 'rsi_reversal') { params.period = effPeriod; params.oversold = oversold; params.overbought = overbought }
  if (strategy === 'kdj_cross' || strategy === 'breakout' || strategy === 'boll_reversal') { params.period = effPeriod }

  return {
    strategy,
    params,
    bars: periods,
    finalEquity: +finalEquity.toFixed(2),
    totalReturn: +totalReturn.toFixed(2),
    annualizedReturn: +annualized.toFixed(2),
    maxDrawdown: +maxDrawdown.toFixed(2),
    tradeCount: trades.length,
    pairCount: pairs,
    winRate: +winRate.toFixed(2),
    trades,
  }
}

/**
 * 策略信号：基于最新一根的技术指标给出多空判断。
 */
export function strategySignals(bars) {
  if (!Array.isArray(bars) || bars.length < 30) throw new Error('K 线数据不足（<30 根）')
  const closes = bars.map((b) => b.close)
  const highs = bars.map((b) => b.high)
  const lows = bars.map((b) => b.low)
  const last = bars.length - 1
  const price = closes[last]

  const ma5 = ind.sma(closes, 5)
  const ma10 = ind.sma(closes, 10)
  const ma20 = ind.sma(closes, 20)
  const ma60 = ind.sma(closes, 60)
  const { dif, dea, hist } = ind.macd(closes)
  const rsi = ind.rsi(closes, 14)
  const { k, d, j } = ind.kdj(highs, lows, closes, 9)
  const { up, mid, low } = ind.boll(closes, 20, 2)

  const signals = []
  let bull = 0
  let bear = 0

  // 均线
  if (ma5[last] != null && ma10[last] != null && ma20[last] != null) {
    const bullishAlign = ma5[last] > ma10[last] && ma10[last] > ma20[last]
    const bearishAlign = ma5[last] < ma10[last] && ma10[last] < ma20[last]
    if (bullishAlign) { signals.push({ name: '均线多头排列', direction: 'bull', note: 'MA5>MA10>MA20' }); bull++ }
    else if (bearishAlign) { signals.push({ name: '均线空头排列', direction: 'bear', note: 'MA5<MA10<MA20' }); bear++ }
    else signals.push({ name: '均线纠缠', direction: 'neutral', note: '短期均线缠绕' })
  }
  if (ma20[last] != null) {
    if (price >= ma20[last]) { signals.push({ name: '站上 MA20', direction: 'bull', note: `收盘 ${price} ≥ MA20 ${ma20[last]}` }); bull++ }
    else { signals.push({ name: '跌破 MA20', direction: 'bear', note: `收盘 ${price} < MA20 ${ma20[last]}` }); bear++ }
  }

  // MACD
  if (dif[last] != null && dea[last] != null) {
    if (dif[last] > dea[last]) { signals.push({ name: 'MACD 金叉状态', direction: 'bull', note: `DIF ${dif[last]} > DEA ${dea[last]}` }); bull++ }
    else { signals.push({ name: 'MACD 死叉状态', direction: 'bear', note: `DIF ${dif[last]} < DEA ${dea[last]}` }); bear++ }
  }

  // RSI
  if (rsi[last] != null) {
    if (rsi[last] >= 70) { signals.push({ name: 'RSI 超买', direction: 'bear', note: `RSI ${rsi[last]}` }); bear++ }
    else if (rsi[last] <= 30) { signals.push({ name: 'RSI 超卖', direction: 'bull', note: `RSI ${rsi[last]}` }); bull++ }
    else signals.push({ name: 'RSI 中性', direction: 'neutral', note: `RSI ${rsi[last]}` })
  }

  // KDJ
  if (k[last] != null && d[last] != null) {
    if (k[last] > d[last]) { signals.push({ name: 'KDJ 金叉', direction: 'bull', note: `K ${k[last]} > D ${d[last]}` }); bull++ }
    else { signals.push({ name: 'KDJ 死叉', direction: 'bear', note: `K ${k[last]} < D ${d[last]}` }); bear++ }
  }

  // BOLL
  if (up[last] != null && low[last] != null) {
    if (price >= up[last]) signals.push({ name: '触及布林上轨', direction: 'bear', note: `上轨 ${up[last]}` })
    else if (price <= low[last]) signals.push({ name: '触及布林下轨', direction: 'bull', note: `下轨 ${low[last]}` })
  }

  const overall = bull > bear ? '偏多' : bear > bull ? '偏空' : '震荡'
  return {
    date: bars[last].date,
    close: price,
    bull,
    bear,
    overall,
    signals,
    metrics: {
      ma: { ma5: ma5[last], ma10: ma10[last], ma20: ma20[last], ma60: ma60[last] },
      macd: { dif: dif[last], dea: dea[last], hist: hist[last] },
      rsi: rsi[last],
      kdj: { k: k[last], d: d[last], j: j[last] },
      boll: { up: up[last], mid: mid[last], low: low[last] },
    },
  }
}

/**
 * 6 种策略对最新一根 K 线的当前状态（供 strategy 工具做仪表盘）。
 */
export function strategyStates(bars) {
  if (!Array.isArray(bars) || bars.length < 40) throw new Error('K 线数据不足（<40 根）')
  const closes = bars.map((b) => b.close)
  const highs = bars.map((b) => b.high)
  const lows = bars.map((b) => b.low)
  const last = bars.length - 1
  const price = closes[last]
  const states = []

  // 均线金叉/死叉
  const ma5 = ind.sma(closes, 5)
  const ma20 = ind.sma(closes, 20)
  if (ma5[last] != null && ma20[last] != null) {
    const bull = ma5[last] > ma20[last]
    states.push({
      key: 'ma_cross', name: '均线金叉/死叉',
      direction: bull ? 'bull' : 'bear',
      state: bull ? '多头（金叉后）' : '空头（死叉后）',
      note: `MA5 ${ma5[last]} vs MA20 ${ma20[last]}`,
    })
  }

  // MACD
  const { dif, dea } = ind.macd(closes)
  if (dif[last] != null && dea[last] != null) {
    const bull = dif[last] > dea[last]
    states.push({
      key: 'macd_cross', name: 'MACD',
      direction: bull ? 'bull' : 'bear',
      state: bull ? '金叉状态' : '死叉状态',
      note: `DIF ${dif[last]} vs DEA ${dea[last]}`,
    })
  }

  // RSI 超卖反弹
  const r = ind.rsi(closes, 14)
  if (r[last] != null) {
    const dir = r[last] >= 70 ? 'bear' : r[last] <= 30 ? 'bull' : 'neutral'
    const state = r[last] >= 70 ? '超买（关注回落）' : r[last] <= 30 ? '超卖（关注反弹）' : '中性'
    states.push({ key: 'rsi_reversal', name: 'RSI 超卖反弹', direction: dir, state, note: `RSI ${r[last]}` })
  }

  // KDJ
  const { k, d } = ind.kdj(highs, lows, closes, 9)
  if (k[last] != null && d[last] != null) {
    const bull = k[last] > d[last]
    states.push({
      key: 'kdj_cross', name: 'KDJ',
      direction: bull ? 'bull' : 'bear',
      state: bull ? '金叉状态' : '死叉状态',
      note: `K ${k[last]} vs D ${d[last]}`,
    })
  }

  // N 日突破（20 日）
  const n = 20
  let hh = -Infinity
  let ll = Infinity
  for (let x = Math.max(0, last - n); x < last; x++) {
    hh = Math.max(hh, highs[x])
    ll = Math.min(ll, lows[x])
  }
  let bdir = 'neutral'
  let bstate = '区间内'
  if (price > hh) { bdir = 'bull'; bstate = '突破新高（看多）' }
  else if (price < ll) { bdir = 'bear'; bstate = '跌破新低（看空）' }
  states.push({ key: 'breakout', name: 'N日突破', direction: bdir, state: bstate, note: `前${n}日区间 ${ll.toFixed(2)}~${hh.toFixed(2)}` })

  // 布林带回归
  const { up, low } = ind.boll(closes, 20, 2)
  if (up[last] != null && low[last] != null) {
    let dir = 'neutral'
    let state = '中轨内'
    if (price <= low[last]) { dir = 'bull'; state = '触及下轨（关注反弹）' }
    else if (price >= up[last]) { dir = 'bear'; state = '触及上轨（关注回落）' }
    states.push({ key: 'boll_reversal', name: '布林带回归', direction: dir, state, note: `上轨 ${up[last]} 下轨 ${low[last]}` })
  }

  return states
}
