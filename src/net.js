// 出站请求节流：免费行情接口有风控，按「串行 + 最小间隔 + 随机抖动」排队。
// 所有数据源的真正外发请求都必须先过 waitRequestSlot()，保证不会并发压接口。
const MIN_GAP_MS = Number(process.env.DSH_STOCK_MIN_GAP_MS || 1000)
const JITTER_MS = 250

let nextSlot = 0

/**
 * 申请一个发送时隙：同步占位，再异步等待自己的时隙到来。
 * 并发调用者按调用顺序排队，相邻两次外发请求至少间隔 MIN_GAP_MS。
 */
export async function waitRequestSlot() {
  const now = Date.now()
  const wait = Math.max(0, nextSlot - now)
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS + Math.floor(Math.random() * JITTER_MS)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
}
