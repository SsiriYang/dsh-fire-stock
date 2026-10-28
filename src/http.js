// 统一 HTTP 请求：超时 + User-Agent + 错误处理 + 瞬时错误重试。
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export async function getJson(url, { signal, timeoutMs = 10000, headers = {}, retries = 1 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const signals = []
      if (signal) signals.push(signal)
      if (timeoutMs) signals.push(AbortSignal.timeout(timeoutMs))
      const merged = signals.length ? AbortSignal.any(signals) : undefined
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', ...headers },
        signal: merged,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      if (attempt < retries) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
    }
  }
  throw lastErr
}

// 金额格式化：>=1e8 显示亿，>=1e4 显示万，否则原值。
export function fmtAmount(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const abs = Math.abs(n)
  if (abs >= 1e8) return (n / 1e8).toFixed(2) + '亿'
  if (abs >= 1e4) return (n / 1e4).toFixed(2) + '万'
  return String(n)
}

export function fmtPct(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toFixed(2) + '%'
}
