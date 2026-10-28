// 盯盘定时轮询 + 异动告警：轮询自选股，触发告警写入本地日志 + 桌面通知。
// 告警触达方式：会话内 + 本地告警日志（经 watch_alerts 读取）+ Windows 桌面气泡通知。

import { notify } from './notify.js'

const COOLDOWN_MS = 30 * 60 * 1000 // 同股同类型告警的冷却时间 30 分钟。

export function startWatcher(ctx, store, { quoteFn, klineFn, getConfig } = {}) {
  const quote = quoteFn
  const kline = klineFn
  let running = false
  const lastAlert = new Map() // key: `${code}:${type}` -> timestamp

  function canAlert(now, code, type) {
    const key = `${code}:${type}`
    const prev = lastAlert.get(key) || 0
    return now - prev >= COOLDOWN_MS
  }

  function touch(now, code, type) {
    lastAlert.set(`${code}:${type}`, now)
  }

  async function poll() {
    if (running) return
    running = true
    try {
      const watch = store.getWatch()
      if (!watch.enabled) return
      const cfg = getConfig ? getConfig() : {}
      const list = cfg.watchlist || []
      if (list.length === 0) return
      const now = Date.now()
      const changeThreshold = watch.rules?.changePctThreshold ?? cfg.watchChangePct ?? 3
      const volumeRatio = watch.rules?.volumeRatio ?? cfg.watchVolumeRatio ?? 2
      const notices = []

      for (const item of list) {
        try {
          const q = await quote(item.code)
          const fired = []
          // 涨跌幅异动
          if (Math.abs(q.changePct) >= changeThreshold && canAlert(now, item.code, 'change')) {
            fired.push({ type: 'change', message: `涨跌幅异动 ${q.changePct >= 0 ? '+' : ''}${q.changePct}%` })
            touch(now, item.code, 'change')
          }
          // 涨停 / 跌停
          if (q.changePct >= 9.8 && canAlert(now, item.code, 'limitup')) {
            fired.push({ type: 'limitup', message: '涨停' })
            touch(now, item.code, 'limitup')
          } else if (q.changePct <= -9.8 && canAlert(now, item.code, 'limitdown')) {
            fired.push({ type: 'limitdown', message: '跌停' })
            touch(now, item.code, 'limitdown')
          }
          // 放量（今日累计成交量 vs 前 5 日均量）
          try {
            const bars = await kline(item.code, { period: 'day', count: 6, fq: 'qfq' })
            const prev = bars.slice(0, -1).map((b) => b.volume)
            if (prev.length >= 5) {
              const avg = prev.reduce((s, v) => s + v, 0) / prev.length
              if (avg > 0 && q.volume >= avg * volumeRatio && canAlert(now, item.code, 'volume')) {
                fired.push({ type: 'volume', message: `放量 ${(q.volume / avg).toFixed(1)} 倍（5 日均量）` })
                touch(now, item.code, 'volume')
              }
            }
          } catch {
            // K 线失败仅跳过放量判断
          }

          for (const a of fired) {
            store.appendAlert({
              ts: new Date().toISOString(),
              code: item.code,
              name: q.name || item.name,
              type: a.type,
              message: a.message,
              price: q.price,
              changePct: q.changePct,
            })
            notices.push(`${q.name} ${a.message}`)
          }
        } catch {
          // 单只行情失败跳过
        }
      }

      if (notices.length > 0) {
        notify('盯盘告警', notices.slice(0, 5).join('\n'))
      }
      } catch {
        // 轮询链路任何异常都在此终结：定时器里冒出的未捕获异常会直接
        // 终结宿主进程（表现为「启动正常，过一会儿 DSH 自动退出」）。
      } finally {
        running = false
      }
    }

    // 双保险：定时器回调自身再兜一层，任何 sync/async 抛出都不外溢。
    const timer = setInterval(() => {
      try {
        poll().catch(() => {})
      } catch {
        /* 忽略 */
      }
    }, 30000)
  ctx.effect(() => () => clearInterval(timer))
  return { poll, stop: () => clearInterval(timer) }
}
