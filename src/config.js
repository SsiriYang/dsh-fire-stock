// 插件配置：导出 Config schema 后，新版设置页会按 volatile 字段自动渲染表单，
// 改动无需重启即时生效（DSH 0.2.x 的 SettingsForms 机制）。
// 注意：.volatile() 只能标在「固定路径的标量」上；数组（自选股）属于数据，
// 持久化在 ~/.dsh/storages/stock-assistant.json，由 src/store.js 管理。
import z from '@deepseek-ai/schemastery'

export const NS = 'stock-assistant'

export const DEFAULT_CONFIG = {
  backtestCount: 250,
  initialCapital: 100000,
  maFast: 5,
  maSlow: 20,
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  kdjPeriod: 9,
  breakoutPeriod: 20,
  bollPeriod: 20,
  watchChangePct: 3,
  watchVolumeRatio: 2,
}

/** 设置页表单：只有标了 volatile 的标量字段会被渲染，且支持热更新。 */
export const Config = z.object({
  backtestCount: z.number().step(1).min(40).max(800).default(250)
    .description('回测默认 K 线根数（40–800）').volatile(),
  initialCapital: z.number().min(1000).max(1e9).default(100000)
    .description('回测默认初始资金（元）').volatile(),
  maFast: z.number().step(1).min(2).max(100).default(5)
    .description('均线策略：快线周期').volatile(),
  maSlow: z.number().step(1).min(3).max(250).default(20)
    .description('均线策略：慢线周期').volatile(),
  rsiPeriod: z.number().step(1).min(2).max(100).default(14)
    .description('RSI 周期').volatile(),
  rsiOversold: z.number().min(1).max(50).default(30)
    .description('RSI 超卖阈值（低于此值视为超卖）').volatile(),
  rsiOverbought: z.number().min(50).max(99).default(70)
    .description('RSI 超买阈值（高于此值视为超买）').volatile(),
  kdjPeriod: z.number().step(1).min(2).max(100).default(9)
    .description('KDJ 周期').volatile(),
  breakoutPeriod: z.number().step(1).min(2).max(250).default(20)
    .description('N 日突破：统计窗口').volatile(),
  bollPeriod: z.number().step(1).min(2).max(250).default(20)
    .description('布林带周期').volatile(),
  watchChangePct: z.number().min(0.5).max(20).default(3)
    .description('盯盘：涨跌幅异动阈值（%）').volatile(),
  watchVolumeRatio: z.number().min(1).max(20).default(2)
    .description('盯盘：放量倍数（相对 5 日均量）').volatile(),
})

/** 从（可能不完整的）配置对象合并默认值，得到完整配置。 */
export function mergeConfig(partial) {
  return { ...DEFAULT_CONFIG, ...(partial || {}) }
}

// .volatile() 的字段在运行期是 cosmokit 的「配置引用」对象：{ get(), [Symbol.for('cosmokit.volatile.write')] }。
// 直接当数字用会把它当 object（比较、算术全部失效），所以读取时必须解包。
// 用 Symbol.for 判定，与运行时的 cosmokit 实例无关（跨副本共享同一符号）。
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

function unwrapVolatile(value) {
  if (value && typeof value === 'object' && VOLATILE_WRITE in value) {
    try { return value.get() } catch { return undefined }
  }
  return value
}

/** 把多层配置（初始值 / 设置页生效值 / 工具临时改动）合并成可直接使用的普通对象。 */
export function resolveConfig(...layers) {
  const merged = Object.assign({}, ...layers.filter(Boolean))
  const plain = {}
  for (const [key, value] of Object.entries(merged)) plain[key] = unwrapVolatile(value)
  return mergeConfig(plain)
}
