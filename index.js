// dsh-fire-stock 插件入口：注册行情/热点/分析/自选股/资金流/选股/回测/盯盘工具。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { quote, sectorList, limitUpPool, stockFlow, screenTop, lastTradingDates } from './src/eastmoney.js'
import { kline } from './src/tencent.js'
import * as ind from './src/indicators.js'
import { backtest, strategySignals, strategyStates } from './src/quant.js'
import { stockProfile } from './src/profile.js'
import { runAkshare } from './src/akshare.js'
import { stockNews } from './src/news.js'
import { startWatcher } from './src/watch.js'
import { createStore } from './src/store.js'
import { Config, resolveConfig } from './src/config.js'
import { fmtAmount, fmtPct } from './src/http.js'

// 导出给设置页：新版 SettingsForms 读取 runtime.Config，按 volatile 字段渲染表单。
export { Config }

export const name = 'dsh-fire-stock'
export const inject = ['tools']

// 设置页展示用的能力清单（Host 侧唯一事实来源，Client 按此渲染，避免两边各写一份）。
const CAPABILITIES = [
  { group: '行情', tools: ['stock_quote', 'stock_kline', 'stock_indicators'] },
  { group: '热点', tools: ['sector_rank', 'sector_flow', 'limit_up_pool', 'stock_flow', 'dragon_tiger'] },
  { group: '分析', tools: ['backtest', 'strategy', 'stock_trait', 'stock_finance', 'stock_news'] },
  { group: '选股', tools: ['screen'] },
  { group: '自选/盯盘', tools: ['watchlist_add', 'watchlist_remove', 'watchlist_show', 'watch_start', 'watch_stop', 'watch_status', 'watch_alerts'] },
]

export function apply(ctx, initialConfig = {}) {
  const store = createStore()

  // 同名工具守卫：与其它插件（如 dsh-astock-research）撞名时只跳过这一个工具，
  // 不让整个插件激活失败 —— 否则一处撞名会拖垮应用启动。
  const reg = (tool) => {
    try {
      ctx.tools.register(tool)
    } catch (e) {
      console.warn(`[dsh-fire-stock] 工具 ${tool?.name ?? '?'} 注册失败，已跳过：${e?.message ?? e}`)
    }
  }

  // 配置：DSH 0.2.x 没有 `config` 服务（宿主服务目录里只有 settings / configEditor），
  // 插件自己的配置就挂在 fiber 上：ctx.fiber.config 是校验后的生效值。
  // .volatile() 字段由 loader 原地写回同一个引用对象（loader/volatile-update），
  // 所以每次读取都能拿到最新值 —— 设置页保存后立即生效，无需重启宿主。
  const liveConfig = () => {
    try {
      return ctx.fiber ? ctx.fiber.config : undefined
    } catch {
      return undefined
    }
  }
  const getConfig = () => resolveConfig(initialConfig, liveConfig())

  // 盯盘轮询需要自选股，而自选股存在本地 storages 里（不属于配置）。
  startWatcher(ctx, store, {
    quoteFn: quote,
    klineFn: kline,
    getConfig: () => ({ ...getConfig(), watchlist: store.getWatchlist() }),
  })

  // ---------- 设置页状态接口（同源 GET /dsh-fire-stock/overview）----------
  // 设置页卡片用它显示自选股 / 盯盘 / 告警的真实状态；取不到时前端静默降级。
  ctx.inject(['webServer'], (scoped) => {
    const dispose = scoped.webServer.register({
      kind: 'exact',
      path: '/dsh-fire-stock/overview',
      handler: (req, res) => {
        const cfg = getConfig()
        const watch = store.getWatch()
        const payload = {
          ok: true,
          plugin: name,
          config: cfg,
          capabilities: CAPABILITIES,
          watchlistCount: store.getWatchlist().length,
          watch: {
            enabled: Boolean(watch.enabled),
            rules: {
              changePctThreshold: watch.rules?.changePctThreshold ?? cfg.watchChangePct,
              volumeRatio: watch.rules?.volumeRatio ?? cfg.watchVolumeRatio,
            },
          },
          alertCount: store.getAlerts(999).length,
        }
        res.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(payload))
      },
    })
    return () => dispose()
  })

  // ---------- 实时行情 ----------
  reg(defineTool({
    name: 'stock_quote',
    description: '查询 A 股实时行情：最新价、涨跌幅、开盘/最高/最低/昨收、成交量额、换手率、市盈率、市净率、总市值/流通市值。',
    parameters: {
      code: { type: 'string', required: true, description: '6 位股票代码，如 600000、000001、300750' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: renderQuote(v) }],
    },
    execute: async (args) => quote(String(args.code).trim()),
    timeoutMs: 15000,
  }))

  // ---------- K 线 ----------
  reg(defineTool({
    name: 'stock_kline',
    description: '查询 A 股历史 K 线（前复权）。period 支持 day/week/month（分钟级暂不保证）。',
    parameters: {
      code: { type: 'string', required: true, description: '6 位股票代码' },
      period: { type: 'string', enum: ['day', 'week', 'month'], description: '周期，默认 day' },
      count: { type: 'integer', description: '返回根数，默认 60，最大 250' },
    },
    output: {
      schema: { type: 'array', items: { type: 'object', additionalProperties: true } },
      render: (_a, v) => [{ type: 'text', text: renderKline(v) }],
    },
    execute: async (args) => {
      const count = Math.max(1, Math.min(args.count ?? 60, 250))
      return kline(String(args.code).trim(), { period: args.period ?? 'day', count, fq: 'qfq' })
    },
    timeoutMs: 15000,
  }))

  // ---------- 技术指标 ----------
  reg(defineTool({
    name: 'stock_indicators',
    description: '计算 A 股技术指标（基于前复权日线）：MA5/10/20/60、MACD、RSI(14)、KDJ(9)、BOLL(20,2)，返回最新一根的值。',
    parameters: {
      code: { type: 'string', required: true, description: '6 位股票代码' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: renderIndicators(v) }],
    },
    execute: async (args) => {
      const bars = await kline(String(args.code).trim(), { period: 'day', count: 120, fq: 'qfq' })
      if (bars.length < 30) throw new Error('K 线数据不足（<30 根）')
      const closes = bars.map((b) => b.close)
      const highs = bars.map((b) => b.high)
      const lows = bars.map((b) => b.low)
      const last = bars.length - 1
      const ma5 = ind.sma(closes, 5)
      const ma10 = ind.sma(closes, 10)
      const ma20 = ind.sma(closes, 20)
      const ma60 = ind.sma(closes, 60)
      const { dif, dea, hist } = ind.macd(closes)
      const rsi14 = ind.rsi(closes, 14)
      const { k, d, j } = ind.kdj(highs, lows, closes, 9)
      const { mid, up, low } = ind.boll(closes, 20, 2)
      return {
        code: String(args.code).trim(),
        date: bars[last].date,
        close: closes[last],
        ma: { ma5: ma5[last], ma10: ma10[last], ma20: ma20[last], ma60: ma60[last] },
        macd: { dif: dif[last], dea: dea[last], hist: hist[last] },
        rsi: rsi14[last],
        kdj: { k: k[last], d: d[last], j: j[last] },
        boll: { up: up[last], mid: mid[last], low: low[last] },
      }
    },
    timeoutMs: 15000,
  }))

  // ---------- 板块排名 ----------
  reg(defineTool({
    name: 'sector_rank',
    description: '行业/概念/地域板块涨跌幅排名（含上涨家数、下跌家数）。用于筛选当日强势/弱势板块。东财 push2 不可达时依次降级同花顺（分类更细、带主力净流入）与新浪（更快但无资金流）；region 仅东财提供。',
    parameters: {
      type: { type: 'string', enum: ['industry', 'concept', 'region'], description: '板块类型：industry 行业 / concept 概念 / region 地域，默认 industry' },
      limit: { type: 'integer', description: '返回数量，默认 20，最大 100' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: renderSector(v) }],
    },
    execute: async (args) => {
      const limit = Math.max(1, Math.min(args.limit ?? 20, 100))
      const list = await sectorList({ type: args.type ?? 'industry', sort: 'pct', limit })
      return { type: args.type ?? 'industry', sort: 'pct', list }
    },
    timeoutMs: 15000,
  }))

  reg(defineTool({
    name: 'sector_flow',
    description: '行业/概念/地域板块主力资金净流入排名，用于识别主力资金流向的热点板块。东财 push2 不可达时自动降级同花顺源：industry/concept 可用，region 不可用，净额为同花顺口径。',
    parameters: {
      type: { type: 'string', enum: ['industry', 'concept', 'region'], description: '板块类型，默认 industry' },
      limit: { type: 'integer', description: '返回数量，默认 20，最大 100' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: renderSector(v) }],
    },
    execute: async (args) => {
      const limit = Math.max(1, Math.min(args.limit ?? 20, 100))
      const list = await sectorList({ type: args.type ?? 'industry', sort: 'flow', limit })
      return { type: args.type ?? 'industry', sort: 'flow', list }
    },
    timeoutMs: 15000,
  }))

  // ---------- 涨停板池 ----------
  reg(defineTool({
    name: 'limit_up_pool',
    description: '获取最近交易日的涨停板池：涨停股代码/名称/连板数/首次封板时间/封单金额/炸板次数/所属行业。用于短线热点情绪分析。',
    parameters: {
      date: { type: 'string', description: '可选，YYYYMMDD 格式的交易日；缺省自动取最近交易日' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: renderLimitUp(v) }],
    },
    execute: async (args) => limitUpPool({ date: args.date, limit: 200 }),
    timeoutMs: 20000,
  }))

  // ---------- 自选股 ----------
  reg(defineTool({
    name: 'watchlist_add',
    description: '添加股票到自选股（持久化）。若不传 name 会自动查询行情补全名称。',
    parameters: {
      code: { type: 'string', required: true, description: '6 位股票代码' },
      name: { type: 'string', description: '股票名称（可选，缺省自动查询）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: renderWatchlist(v) }],
    },
    execute: async (args) => {
      const code = String(args.code).trim()
      let name = args.name ? String(args.name).trim() : ''
      if (!name) {
        try { name = (await quote(code)).name } catch { name = code }
      }
      const list = [...store.getWatchlist()]
      if (!list.some((w) => w.code === code)) {
        list.push({ code, name })
        store.setWatchlist(list)
        return { action: 'added', code, name, list }
      }
      return { action: 'exists', code, name, list }
    },
    timeoutMs: 15000,
  }))

  reg(defineTool({
    name: 'watchlist_remove',
    description: '从自选股移除指定股票。',
    parameters: {
      code: { type: 'string', required: true, description: '6 位股票代码' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: renderWatchlist(v) }],
    },
    execute: async (args) => {
      const code = String(args.code).trim()
      const list = store.getWatchlist().filter((w) => w.code !== code)
      store.setWatchlist(list)
      return { action: 'removed', code, list }
    },
  }))

  reg(defineTool({
    name: 'watchlist_show',
    description: '查看当前自选股列表，并附每只股票的实时涨跌幅。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: renderWatchlist(v) }],
    },
    execute: async () => {
      const list = store.getWatchlist()
      const items = []
      for (const w of list) {
        try {
          const q = await quote(w.code)
          items.push({ code: w.code, name: w.name || q.name, price: q.price, changePct: q.changePct })
        } catch {
          items.push({ code: w.code, name: w.name || w.code, price: null, changePct: null })
        }
      }
      return { list: items }
    },
    timeoutMs: 20000,
  }))

  // ---------- 个股资金流 ----------
  reg(defineTool({
    name: 'stock_flow',
    description: '查询 A 股个股资金流向：主力/超大单/大单/中单/小单净流入（历史日线）。东财不可达时降级新浪源，只返回最近一个交易日的主力净流入。',
    parameters: {
      code: { type: 'string', required: true, description: '6 位股票代码' },
      days: { type: 'integer', description: '返回近 N 个交易日，默认 10，最大 60' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: renderFlow(v) }] },
    execute: async (args) => stockFlow(String(args.code).trim(), args.days ?? 10),
    timeoutMs: 15000,
  }))

  // ---------- 龙虎榜 ----------
  reg(defineTool({
    name: 'dragon_tiger',
    description: '查询龙虎榜（游资/机构席位），按净买额降序。date 缺省取最近交易日。',
    parameters: {
      date: { type: 'string', description: '可选，YYYYMMDD 交易日；缺省取最近交易日' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: renderLhb(v) }] },
    execute: async (args) => {
      const dates = args.date ? [args.date] : lastTradingDates(7)
      let lastErr = null
      for (const d of dates) {
        try {
          const list = await runAkshare('lhb', { start: d, end: d }, 30000)
          if (Array.isArray(list) && list.length > 0) return { date: d, list }
        } catch (e) { lastErr = e }
      }
      if (lastErr) throw lastErr
      return { date: args.date || dates[0], list: [] }
    },
    timeoutMs: 40000,
  }))

  // ---------- 个股新闻 ----------
  reg(defineTool({
    name: 'stock_news',
    description: '查询个股相关新闻资讯（东方财富）：标题、时间、来源、摘要、链接。用于分析消息面/催化剂。',
    parameters: {
      code: { type: 'string', required: true, description: '6 位股票代码' },
      limit: { type: 'integer', description: '返回条数，默认 10，最大 30' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: renderNews(v) }] },
    execute: async (args) => stockNews(String(args.code).trim(), args.limit ?? 10),
    timeoutMs: 20000,
  }))

  // ---------- 财务摘要 ----------
  reg(defineTool({
    name: 'stock_finance',
    description: '查询 A 股财务摘要：归母净利润、营收、每股收益、ROE、毛利率、资产负债率等关键指标（最近 4 期）。',
    parameters: {
      code: { type: 'string', required: true, description: '6 位股票代码' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: renderFinance(v) }] },
    execute: async (args) => {
      const code = String(args.code).trim()
      const data = await runAkshare('finance_abstract', { code }, 30000)
      return { code, ...data }
    },
    timeoutMs: 40000,
  }))

  // ---------- 条件选股 ----------
  reg(defineTool({
    name: 'screen',
    description: '条件选股：按涨跌幅/换手率/市盈率/市净率/主力净流入/总市值等对全市场排序取前 100 名，再叠加筛选条件（换手/PE/PB/市值/主力净流入/行业/名称）过滤，返回前 limit 名。东财 push2 不可达时自动降级新浪源：此时不支持按主力净流入/量比排序，主力净流入与行业字段为空。',
    parameters: {
      sortBy: { type: 'string', enum: ['changePct', 'turnover', 'pe', 'pb', 'mainInflow', 'totalMv', 'volumeRatio'], description: '排序字段，默认 changePct' },
      order: { type: 'string', enum: ['desc', 'asc'], description: '排序方向，默认 desc' },
      limit: { type: 'integer', description: '返回数量，默认 30，最大 100' },
      minChangePct: { type: 'number', description: '涨跌幅下限（%）' },
      maxChangePct: { type: 'number', description: '涨跌幅上限（%）' },
      minTurnover: { type: 'number', description: '换手率下限（%）' },
      maxPe: { type: 'number', description: '市盈率上限（剔除负值与超过此值的）' },
      maxPb: { type: 'number', description: '市净率上限' },
      minTotalMv: { type: 'number', description: '总市值下限（亿元）' },
      maxTotalMv: { type: 'number', description: '总市值上限（亿元）' },
      mainInflowPositive: { type: 'boolean', description: '只保留主力净流入为正' },
      industry: { type: 'string', description: '行业名称关键字，如 半导体、军工' },
      nameKeyword: { type: 'string', description: '股票名称关键字' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: renderScreen(v) }] },
    execute: async (args) => {
      const sortBy = args.sortBy || 'changePct'
      const order = args.order || 'desc'
      let rows = await screenTop({ sortBy, order, limit: 100 })
      if (args.minChangePct != null) rows = rows.filter((r) => r.changePct != null && r.changePct >= args.minChangePct)
      if (args.maxChangePct != null) rows = rows.filter((r) => r.changePct != null && r.changePct <= args.maxChangePct)
      if (args.minTurnover != null) rows = rows.filter((r) => r.turnover != null && r.turnover >= args.minTurnover)
      if (args.maxPe != null) rows = rows.filter((r) => r.pe != null && r.pe > 0 && r.pe <= args.maxPe)
      if (args.maxPb != null) rows = rows.filter((r) => r.pb != null && r.pb > 0 && r.pb <= args.maxPb)
      if (args.minTotalMv != null) rows = rows.filter((r) => r.totalMv != null && r.totalMv / 1e8 >= args.minTotalMv)
      if (args.maxTotalMv != null) rows = rows.filter((r) => r.totalMv != null && r.totalMv / 1e8 <= args.maxTotalMv)
      if (args.mainInflowPositive) rows = rows.filter((r) => r.mainInflow != null && r.mainInflow > 0)
      if (args.industry) rows = rows.filter((r) => (r.industry || '').includes(args.industry))
      if (args.nameKeyword) rows = rows.filter((r) => (r.name || '').includes(args.nameKeyword))
      const limit = Math.max(1, Math.min(args.limit ?? 30, 100))
      return { sortBy, order, matched: rows.length, list: rows.slice(0, limit) }
    },
    timeoutMs: 60000,
  }))

  // ---------- 回测 ----------
  reg(defineTool({
    name: 'backtest',
    description: '策略回测（简化）：基于前复权日线全仓进出，输出收益/回撤/胜率（不含手续费滑点）。支持 6 种策略：均线金叉/死叉、MACD、RSI 超卖反弹、KDJ、N日突破、布林带回归。不确定用哪种策略时，可先用 stock_trait 识别股性并获得策略推荐。',
    parameters: {
      code: { type: 'string', required: true, description: '6 位股票代码' },
      strategy: { type: 'string', enum: ['ma_cross', 'macd_cross', 'rsi_reversal', 'kdj_cross', 'breakout', 'boll_reversal'], description: '策略，默认 ma_cross' },
      fast: { type: 'integer', description: '快线参数（ma_cross），默认 5' },
      slow: { type: 'integer', description: '慢线参数（ma_cross），默认 20' },
      period: { type: 'integer', description: '周期参数（rsi 默认14 / kdj 默认9 / breakout 与 boll 默认20）' },
      oversold: { type: 'number', description: '超卖阈值（rsi_reversal），默认 30' },
      overbought: { type: 'number', description: '超买阈值（rsi_reversal），默认 70' },
      count: { type: 'integer', description: '回测 K 线根数，默认 250，最大 800' },
      initialCapital: { type: 'number', description: '初始资金，默认 100000' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: renderBacktest(v) }] },
    execute: async (args) => {
      const code = String(args.code).trim()
      const cfg = getConfig()
      const strategy = args.strategy ?? 'ma_cross'
      const periodByStrategy = { rsi_reversal: cfg.rsiPeriod, kdj_cross: cfg.kdjPeriod, breakout: cfg.breakoutPeriod, boll_reversal: cfg.bollPeriod }
      const count = Math.max(40, Math.min(args.count ?? cfg.backtestCount, 800))
      const bars = await kline(code, { period: 'day', count, fq: 'qfq' })
      return { code, ...backtest(bars, { strategy, fast: args.fast ?? cfg.maFast, slow: args.slow ?? cfg.maSlow, period: args.period ?? periodByStrategy[strategy], oversold: args.oversold ?? cfg.rsiOversold, overbought: args.overbought ?? cfg.rsiOverbought, initialCapital: args.initialCapital ?? cfg.initialCapital }) }
    },
    timeoutMs: 20000,
  }))

  // ---------- 策略信号 ----------
  reg(defineTool({
    name: 'strategy',
    description: '个股多空信号仪表盘：综合均线/MACD/RSI/KDJ/BOLL 给出偏多/偏空/震荡判断，并列出 6 种交易策略（均线、MACD、RSI、KDJ、突破、布林）的当前状态。',
    parameters: {
      code: { type: 'string', required: true, description: '6 位股票代码' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: renderStrategy(v) }] },
    execute: async (args) => {
      const code = String(args.code).trim()
      const bars = await kline(code, { period: 'day', count: 120, fq: 'qfq' })
      return { code, ...strategySignals(bars), states: strategyStates(bars) }
    },
    timeoutMs: 20000,
  }))

  // ---------- 股性识别 + 策略匹配 ----------
  reg(defineTool({
    name: 'stock_trait',
    description: '识别个股股性（趋势型/波段型/震荡型、波动水平），并匹配适合该股性的交易策略，自动用推荐策略回测对比。在用户想了解或回测一只股票、又不确定用哪种策略时，先调用本工具判断股性并获取策略推荐；随后可用 backtest 按推荐策略回测。',
    parameters: {
      code: { type: 'string', required: true, description: '6 位股票代码' },
      count: { type: 'integer', description: '分析 K 线根数，默认 250，最大 250' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: renderProfile(v) }] },
    execute: async (args) => {
      const code = String(args.code).trim()
      const count = Math.max(60, Math.min(args.count ?? 250, 250))
      const bars = await kline(code, { period: 'day', count, fq: 'qfq' })
      return { code, ...stockProfile(bars) }
    },
    timeoutMs: 30000,
  }))

  // ---------- 盯盘 ----------
  reg(defineTool({
    name: 'watch_start',
    description: '开始盯盘：后台每 30 秒轮询自选股，触发涨跌幅异动/涨停跌停/放量告警并写入本地日志（用 watch_alerts 查看）。',
    parameters: {
      changePctThreshold: { type: 'number', description: '涨跌幅异动阈值（%），默认 3' },
      volumeRatio: { type: 'number', description: '放量倍数（相对 5 日均量），默认 2' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: renderWatch(v) }] },
    execute: async (args) => {
      const cfg = getConfig()
      // 显式传入的阈值存进 watch.rules（不改设置页的值）；没传就跟随设置页/默认值。
      const rules = {}
      if (args.changePctThreshold != null) rules.changePctThreshold = args.changePctThreshold
      if (args.volumeRatio != null) rules.volumeRatio = args.volumeRatio
      store.setWatch({ enabled: true, ...(Object.keys(rules).length > 0 ? { rules } : {}) })
      const w = store.getWatch()
      const effective = {
        changePctThreshold: w.rules?.changePctThreshold ?? cfg.watchChangePct,
        volumeRatio: w.rules?.volumeRatio ?? cfg.watchVolumeRatio,
      }
      return { enabled: true, rules: effective, watchlistCount: store.getWatchlist().length, note: '盯盘已开启，告警写入本地日志，可用 watch_alerts 查看' }
    },
  }))

  reg(defineTool({
    name: 'watch_stop',
    description: '停止盯盘。',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: renderWatch(v) }] },
    execute: async () => {
      // 停止即清空会话内阈值覆盖，之后回到设置页的值。
      store.setWatch({ enabled: false })
      return { enabled: false, note: '盯盘已停止' }
    },
  }))

  reg(defineTool({
    name: 'watch_status',
    description: '查看盯盘状态：是否开启、告警规则、自选股数量、累计告警数。',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: renderWatch(v) }] },
    execute: async () => {
      const watch = store.getWatch()
      const cfg = getConfig()
      return { enabled: watch.enabled, rules: { changePctThreshold: watch.rules?.changePctThreshold ?? cfg.watchChangePct, volumeRatio: watch.rules?.volumeRatio ?? cfg.watchVolumeRatio }, watchlistCount: store.getWatchlist().length, alertCount: store.getAlerts(999).length }
    },
  }))

  reg(defineTool({
    name: 'watch_alerts',
    description: '查看盯盘告警日志（最近触发的异动）。',
    parameters: {
      limit: { type: 'integer', description: '返回数量，默认 30，最大 200' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: renderAlerts(v) }] },
    execute: async (args) => ({ alerts: store.getAlerts(Math.max(1, Math.min(args.limit ?? 30, 200))) }),
  }))

  console.log('[dsh-fire-stock] 已注册工具: stock_quote, stock_kline, stock_indicators, sector_rank, sector_flow, limit_up_pool, watchlist_add, watchlist_remove, watchlist_show, stock_flow, dragon_tiger, stock_news, stock_finance, screen, backtest, strategy, stock_trait, watch_start, watch_stop, watch_status, watch_alerts')
}

// ---------------- render helpers ----------------

function renderQuote(v) {
  const lines = []
  lines.push(`${v.name}(${v.code})  ${v.price}  ${fmtPct(v.changePct)}  (${v.change > 0 ? '+' : ''}${v.change})`)
  lines.push(`今开 ${v.open}  最高 ${v.high}  最低 ${v.low}  昨收 ${v.prevClose}`)
  lines.push(`振幅 ${fmtPct(v.amplitude)}  换手 ${fmtPct(v.turnover)}  量 ${v.volume}手  额 ${fmtAmount(v.amount)}`)
  lines.push(`市盈率(动) ${v.pe ?? '—'}  市净率 ${v.pb ?? '—'}`)
  lines.push(`总市值 ${fmtAmount(v.totalMv)}  流通市值 ${fmtAmount(v.floatMv)}`)
  return lines.join('\n')
}

function renderKline(bars) {
  const head = `共 ${bars.length} 根（前复权）：日期 / 开 / 收 / 高 / 低 / 量`
  const rows = bars.map((b) =>
    `${b.date}  开${b.open}  收${b.close}  高${b.high}  低${b.low}  量${b.volume}`
  )
  return [head, ...rows].join('\n')
}

function renderIndicators(v) {
  const m = v.ma
  const ma = m.ma60 != null
    ? `MA5 ${m.ma5}  MA10 ${m.ma10}  MA20 ${m.ma20}  MA60 ${m.ma60}`
    : `MA5 ${m.ma5}  MA10 ${m.ma10}  MA20 ${m.ma20}`
  const trend = m.ma20 != null ? (v.close >= m.ma20 ? '收盘价在 MA20 上方' : '收盘价在 MA20 下方') : ''
  const lines = [
    `${v.code}  最新收盘 ${v.close}（${v.date}）`,
    ma,
    `MACD  DIF ${v.macd.dif}  DEA ${v.macd.dea}  MACD柱 ${v.macd.hist}  (${v.macd.dif > v.macd.dea ? '金叉/多头' : '死叉/空头'})`,
    `RSI(14) ${v.rsi}  KDJ  K${v.kdj.k} D${v.kdj.d} J${v.kdj.j}`,
    `BOLL  上轨 ${v.boll.up}  中轨 ${v.boll.mid}  下轨 ${v.boll.low}`,
  ]
  if (trend) lines.push(trend)
  lines.push('注：以上为技术指标数值，仅作参考，不构成投资建议。')
  return lines.join('\n')
}

function renderSector(v) {
  const label = { industry: '行业', concept: '概念', region: '地域' }[v.type] || v.type
  const sortLabel = v.sort === 'flow' ? '主力净流入' : '涨跌幅'
  const source = v.list[0] && v.list[0].source
  const lines = [`${label}板块按${sortLabel}排名（共 ${v.list.length}）：`]
  v.list.forEach((s, i) => {
    const flow = s.mainNetInflow != null ? `${s.mainNetInflow >= 0 ? '+' : ''}${fmtAmount(s.mainNetInflow)}` : '—'
    const counts = s.upCount != null && s.downCount != null ? `  涨${s.upCount}家/跌${s.downCount}家` : ''
    const lead = s.leadName ? `  领涨 ${s.leadName}${s.leadPct != null ? ' ' + fmtPct(s.leadPct) : ''}` : ''
    lines.push(`${i + 1}. ${s.name}  涨跌 ${fmtPct(s.changePct)}${counts}  主力净流入 ${flow}${lead}`)
  })
  if (source === 'sina') lines.push('注：东财 push2 不可达，本次为新浪备用源数据（无上涨/下跌家数、无主力净流入）。')
  else if (source === 'ths') lines.push('注：东财 push2 不可达，本次为同花顺备用源数据（主力净流入为同花顺口径，无上涨/下跌家数）。')
  return lines.join('\n')
}

function renderLimitUp(v) {
  const lines = [`涨停板池（${v.date}，共 ${v.total} 只）：`]
  v.pool.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.name}(${p.code})  连板${p.streak}  首次封板${p.firstSeal}  封单${fmtAmount(p.sealAmount)}  炸板${p.breakCount}次  ${p.industry || ''}`)
  })
  if (v.total === 0) lines.push('（当日无涨停数据）')
  return lines.join('\n')
}

function renderWatchlist(v) {
  if (v.action) {
    const msg = { added: '已加入自选股', exists: '已在自选股中', removed: '已从自选股移除' }[v.action] || v.action
    const codes = (v.list || []).map((w) => `${w.name}(${w.code})`).join('、')
    return `${msg}：${v.code ? v.code : ''}\n当前自选股（${(v.list || []).length}）：${codes}`
  }
  const lines = [`自选股（共 ${v.list.length}）：`]
  v.list.forEach((w, i) => {
    const p = w.price != null ? `  ${w.price}  ${fmtPct(w.changePct)}` : ''
    lines.push(`${i + 1}. ${w.name}(${w.code})${p}`)
  })
  return lines.join('\n')
}

function renderFlow(v) {
  const sign = (n) => (n == null ? '' : n >= 0 ? '+' : '')
  const lines = [`${v.name}(${v.code}) 资金流向（近 ${v.list.length} 日）：`]
  v.list.forEach((x) => {
    lines.push(`${x.date}  主力${sign(x.main)}${fmtAmount(x.main)}  超大${sign(x.superLarge)}${fmtAmount(x.superLarge)}  大${sign(x.large)}${fmtAmount(x.large)}  中${sign(x.medium)}${fmtAmount(x.medium)}  小${sign(x.small)}${fmtAmount(x.small)}`)
  })
  lines.push(`近 ${v.list.length} 日主力累计净流入：${sign(v.totalMain)}${fmtAmount(v.totalMain)}`)
  if (v.note) lines.push(v.note)
  return lines.join('\n')
}

function renderLhb(v) {
  const lines = [`龙虎榜（${v.date}，共 ${v.list.length} 条，按净买额降序）：`]
  v.list.forEach((x, i) => {
    const net = x.netBuy != null ? (x.netBuy >= 0 ? '+' : '') + fmtAmount(x.netBuy) : '—'
    lines.push(`${i + 1}. ${x.name}(${x.code})  涨跌${fmtPct(x.changePct)}  净买额${net}  ${x.reason || ''}`)
  })
  if (v.list.length === 0) lines.push('（当日无龙虎榜数据）')
  return lines.join('\n')
}

function renderNews(v) {
  const lines = [`${v.name || ''}(${v.code}) 相关新闻（检索词：${v.keyword}，共 ${v.list.length} 条）：`]
  v.list.forEach((a, i) => {
    lines.push(`${i + 1}. [${a.date}] ${a.title}（${a.source}）`)
    if (a.content) lines.push(`   ${a.content}`)
    if (a.url) lines.push(`   ${a.url}`)
  })
  if (v.list.length === 0) lines.push('（无相关新闻）')
  return lines.join('\n')
}

function renderFinance(v) {
  const periods = v.periods || []
  const lines = [`${v.code} 财务摘要（最近 ${periods.length} 期）：`]
  lines.push('指标 | ' + periods.map((p) => p.slice(0, 6)).join(' | '))
  for (const row of (v.indicators || [])) {
    const vals = periods.map((p) => {
      const val = row[p]
      if (val == null) return '—'
      if (Math.abs(val) >= 1e8) return fmtAmount(val)
      if (Math.abs(val) >= 1e4) return (val / 1e4).toFixed(2) + '万'
      return Number(val).toFixed(2)
    }).join(' | ')
    lines.push(`${row.indicator} | ${vals}`)
  }
  return lines.join('\n')
}

function renderScreen(v) {
  const num2 = (x) => (x == null || Number.isNaN(Number(x)) ? '—' : Number(x).toFixed(2))
  const labels = { changePct: '涨跌幅', turnover: '换手率', pe: '市盈率', pb: '市净率', mainInflow: '主力净流入', totalMv: '总市值', volumeRatio: '量比' }
  const lines = [`条件选股结果：全市场按${labels[v.sortBy] || v.sortBy}${v.order === 'asc' ? '升序' : '降序'}前 100 名内，匹配 ${v.matched} 只，取前 ${v.list.length}：`]
  v.list.forEach((s, i) => {
    const inflow = s.mainInflow != null ? (s.mainInflow >= 0 ? '+' : '') + fmtAmount(s.mainInflow) : '—'
    const industry = s.industry ? '  ' + s.industry : ''
    lines.push(`${i + 1}. ${s.name}(${s.code})  涨跌${fmtPct(s.changePct)}  换手${num2(s.turnover)}%  PE${num2(s.pe)}  PB${num2(s.pb)}  主力${inflow}  市值${s.totalMv != null ? fmtAmount(s.totalMv) : '—'}${industry}`)
  })
  if (v.list.length === 0) lines.push('（无匹配标的）')
  if (v.list.length > 0 && v.list[0].source === 'sina') {
    lines.push('注：东财 push2 不可达，本次为新浪备用源数据（无主力净流入、无所属行业、无量比）。')
  }
  return lines.join('\n')
}

function renderBacktest(v) {
  const names = {
    ma_cross: '均线金叉/死叉',
    macd_cross: 'MACD 金叉/死叉',
    rsi_reversal: 'RSI 超卖反弹',
    kdj_cross: 'KDJ 金叉/死叉',
    breakout: 'N日突破',
    boll_reversal: '布林带回归',
  }
  const stratName = names[v.strategy] || v.strategy
  const p = v.params || {}
  let paramStr = ''
  if (v.strategy === 'ma_cross') paramStr = `参数 ${p.fast}/${p.slow}`
  else if (v.strategy === 'rsi_reversal') paramStr = `周期 ${p.period} 超卖${p.oversold}/超买${p.overbought}`
  else if (v.strategy === 'kdj_cross' || v.strategy === 'breakout' || v.strategy === 'boll_reversal') paramStr = `周期 ${p.period}`
  const lines = [
    `${v.code} 回测结果（策略：${stratName}${paramStr ? '，' + paramStr : ''}，${v.bars} 根 K 线，初始 ${p.initialCapital}）`,
    `期末权益 ${v.finalEquity}  总收益 ${v.totalReturn}%  年化 ${v.annualizedReturn}%`,
    `最大回撤 ${v.maxDrawdown}%  交易 ${v.tradeCount} 次（${v.pairCount} 组买卖）  胜率 ${v.winRate}%`,
  ]
  const t = v.trades || []
  const shown = t.slice(-12)
  if (t.length > 12) lines.push(`……（共 ${t.length} 笔，显示最近 ${shown.length} 笔）`)
  shown.forEach((x) => lines.push(`${x.type === 'buy' ? '买入' : '卖出'}  ${x.date}  @${x.price}`))
  lines.push('注：简化回测，不含手续费/滑点，信号当日收盘成交，仅供参考。')
  return lines.join('\n')
}

function renderStrategy(v) {
  const dirLabel = { bull: '看多', bear: '看空', neutral: '中性' }
  const lines = [`${v.code} 多空信号（${v.date}，收盘 ${v.close}）：综合判断【${v.overall}】（多 ${v.bull} / 空 ${v.bear}）`]
  for (const s of v.signals) {
    lines.push(`  ${dirLabel[s.direction] || ''} ${s.name}${s.note ? '：' + s.note : ''}`)
  }
  if (Array.isArray(v.states) && v.states.length > 0) {
    lines.push('')
    lines.push('── 6 种策略当前状态 ──')
    let bullN = 0
    let bearN = 0
    for (const s of v.states) {
      const tag = s.direction === 'bull' ? '🟢' : s.direction === 'bear' ? '🔴' : '⚪'
      if (s.direction === 'bull') bullN++
      else if (s.direction === 'bear') bearN++
      lines.push(`  ${tag} ${s.name}：${s.state}${s.note ? '（' + s.note + '）' : ''}`)
    }
    lines.push(`  —— 策略共识：${bullN} 看多 / ${bearN} 看空 / ${v.states.length - bullN - bearN} 中性 ——`)
  }
  lines.push('注：技术信号仅作参考，不构成投资建议。')
  return lines.join('\n')
}

function renderProfile(v) {
  const c = v.character
  const styleLabel = { trend: '趋势跟随', swing: '波段', range: '均值回归' }
  const m = c.metrics
  const lines = [
    `${v.code} 股性识别（${v.start} ~ ${v.end}，近 ${v.window} 根日线）`,
    `股性：${c.label}（偏好风格：${styleLabel[c.style] || c.style}）`,
    `  年化波动率 ${m.volatility}%  趋势拟合 R² ${m.trendR2}  年化对数趋势 ${m.trendAnnual}%`,
    `  收益自相关 ${m.returnAutocorr}  均线多头占比 ${(m.maAlignment * 100).toFixed(0)}%  窗口最大回撤 ${m.maxDrawdown}%  布林带宽 ${m.bollWidth}%`,
  ]
  for (const note of c.notes) lines.push(`  · ${note}`)
  lines.push('')
  lines.push(`推荐策略（匹配度排序，前 ${v.strategies.length} 个）：`)
  v.strategies.forEach((s, i) => {
    const b = s.backtest
    lines.push(`${i + 1}. ${s.name}（${s.key}）匹配度 ${s.score} —— ${s.reason}`)
    lines.push(`   回测：总收益 ${b.totalReturn}%  年化 ${b.annualizedReturn}%  最大回撤 ${b.maxDrawdown}%  交易 ${b.tradeCount} 次  胜率 ${b.winRate}%`)
  })
  lines.push('')
  lines.push(`建议：${v.suggestion}`)
  lines.push('注：股性识别基于历史统计，策略匹配为启发式打分；简化回测不含手续费/滑点，仅供参考，不构成投资建议。')
  return lines.join('\n')
}

function renderWatch(v) {
  if (v.enabled === false && v.note && v.rules == null) return v.note
  const lines = [`盯盘状态：${v.enabled ? '已开启' : '未开启'}`]
  if (v.rules) lines.push(`规则：涨跌幅阈值 ±${v.rules.changePctThreshold ?? 3}%，放量 ${v.rules.volumeRatio ?? 2} 倍`)
  if (v.watchlistCount != null) lines.push(`自选股 ${v.watchlistCount} 只`)
  if (v.alertCount != null) lines.push(`累计告警 ${v.alertCount} 条`)
  if (v.note) lines.push(v.note)
  return lines.join('\n')
}

// ISO(UTC) → 本地时间，避免告警时间比本地慢 8 小时。
function fmtLocalTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 19).replace('T', ' ')
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function renderAlerts(v) {
  const alerts = v.alerts || []
  const lines = [`盯盘告警（共 ${alerts.length} 条，最近在前）：`]
  alerts.forEach((a, i) => {
    const t = fmtLocalTime(a.ts)
    const pct = a.changePct != null ? ' ' + fmtPct(a.changePct) : ''
    const price = a.price != null ? ' 现价' + a.price : ''
    lines.push(`${i + 1}. [${t}] ${a.name}(${a.code}) ${a.message}${price}${pct}`)
  })
  if (alerts.length === 0) lines.push('（暂无告警）')
  return lines.join('\n')
}
