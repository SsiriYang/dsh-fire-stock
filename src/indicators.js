// 技术指标纯函数：基于收盘价/最高/最低序列计算，返回与输入等长的数组（前段用 null 占位）。

export function sma(values, n) {
  const out = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= n) sum -= values[i - n]
    out.push(i >= n - 1 ? +(sum / n).toFixed(3) : null)
  }
  return out
}

export function ema(values, n) {
  const k = 2 / (n + 1)
  const out = []
  let prev = values[0]
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const dif = closes.map((_, i) => emaFast[i] - emaSlow[i])
  const dea = ema(dif, signal)
  const hist = dif.map((d, i) => +(d - dea[i]).toFixed(3) * 2)
  return { dif: dif.map((v) => +v.toFixed(3)), dea: dea.map((v) => +v.toFixed(3)), hist }
}

export function rsi(closes, n = 14) {
  const out = []
  let avgGain = 0
  let avgLoss = 0
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      out.push(null)
      continue
    }
    const ch = closes[i] - closes[i - 1]
    const gain = Math.max(ch, 0)
    const loss = Math.max(-ch, 0)
    if (i <= n) {
      avgGain = (avgGain * (i - 1) + gain) / i
      avgLoss = (avgLoss * (i - 1) + loss) / i
      out.push(i === n ? rsiOf(avgGain, avgLoss) : null)
    } else {
      avgGain = (avgGain * (n - 1) + gain) / n
      avgLoss = (avgLoss * (n - 1) + loss) / n
      out.push(rsiOf(avgGain, avgLoss))
    }
  }
  return out
}

function rsiOf(avgGain, avgLoss) {
  if (avgLoss === 0) return 100
  return +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2)
}

export function kdj(highs, lows, closes, n = 9) {
  const k = []
  const d = []
  const j = []
  let kPrev = 50
  let dPrev = 50
  for (let i = 0; i < closes.length; i++) {
    const start = Math.max(0, i - n + 1)
    let hh = -Infinity
    let ll = Infinity
    for (let x = start; x <= i; x++) {
      hh = Math.max(hh, highs[x])
      ll = Math.min(ll, lows[x])
    }
    const rsv = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100
    const kCur = (2 / 3) * kPrev + (1 / 3) * rsv
    const dCur = (2 / 3) * dPrev + (1 / 3) * kCur
    const jCur = 3 * kCur - 2 * dCur
    k.push(+kCur.toFixed(2))
    d.push(+dCur.toFixed(2))
    j.push(+jCur.toFixed(2))
    kPrev = kCur
    dPrev = dCur
  }
  return { k, d, j }
}

export function boll(closes, n = 20, mult = 2) {
  const mid = sma(closes, n)
  const up = []
  const low = []
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] == null) {
      up.push(null)
      low.push(null)
      continue
    }
    const seg = closes.slice(i - n + 1, i + 1)
    const mean = mid[i]
    const variance = seg.reduce((s, v) => s + (v - mean) ** 2, 0) / n
    const std = Math.sqrt(variance)
    up.push(+(mean + mult * std).toFixed(3))
    low.push(+(mean - mult * std).toFixed(3))
  }
  return { mid, up, low }
}
