# dsh-fire-stock

A-share quotes, market hotspots and quant analysis assistant — a plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

Data sources: Eastmoney public endpoints (quotes, sectors, limit-up pool, money flow, news) + Tencent quotes (adjusted K-lines) + akshare (dragon-tiger list, financial abstracts).

> ⚠️ Data comes from unofficial public endpoints. For research/learning only — **not investment advice**.

## Features

Registers 21 model tools, a standalone **"Stock Assistant"** settings section, and watch alerts (session log + Windows toast notifications).

| Category | Tools |
|---|---|
| Quotes & analysis | `stock_quote` `stock_kline` `stock_indicators` `strategy` |
| Personality & strategy | `stock_profile` (stock personality recognition + strategy matching + auto backtest) |
| Hotspots | `sector_rank` `sector_flow` `limit_up_pool` `dragon_tiger` |
| Flow, finance & news | `stock_flow` `stock_finance` `stock_news` |
| Quant | `screen` (multi-factor screener) `backtest` (6-strategy backtest) |
| Watchlist & alerts | `watchlist_add` `watchlist_remove` `watchlist_show` `watch_start` `watch_stop` `watch_status` `watch_alerts` |

The settings section (Settings → **Stock Assistant**) edits the watchlist, backtest/strategy parameters and alert thresholds; edits apply after clicking **Save** (bottom-right), and **Initialize** restores all defaults. Strategy parameters are grouped under per-strategy headings (e.g. "RSI 超卖反弹 / RSI mean reversion").

## Installation

Prerequisites:

- Node.js ≥ 18 (required to build the client bundle)
- Python 3 + [akshare](https://github.com/akfamily/akshare) (only `dragon_tiger` and `stock_finance` need it; `pip install akshare`)
- Windows: toast notifications are Windows-only (silently skipped on other platforms)

### Option 1: install from GitHub

```sh
dsh plugin --profile web add github:SsiriYang/dsh-fire-stock
```

> Recommended: pin a commit for reproducibility — `dsh plugin --profile web add git+https://github.com/SsiriYang/dsh-fire-stock.git#<commit>`

### Option 2: local development

```sh
git clone https://github.com/SsiriYang/dsh-fire-stock.git
cd dsh-fire-stock
pnpm install
pnpm build        # validation only — see note below

# install from a DSH checkout (junction into the source dir: edits are live)
cd <path-to>/deepseek-harness
pnpm dsh plugin --profile web add <path-to>/dsh-fire-stock
```

> ⚠️ `lib/client.js` is **hand-written source**, not a build artifact. It is committed as-is and must not be regenerated: it targets the DSH 0.2.x client API (`ctx.configForms`, `plugins.item` / `settings.section` slots). `pnpm build` only runs `scripts/verify.mjs`, which syntax-checks every runtime file and asserts the bundle's contract (module id, slots, locale namespace, package name, patch id) — so a broken or stale bundle fails the build instead of silently disabling the settings card.
>
> The package declares `exports["./client"]`, so `lib/client.js` must exist — otherwise the web boot page reports `Failed to load plugins`. It is committed, so GitHub installs need no build step at all.

## Usage

Add stocks to the watchlist (via chat tools or the settings section), then:

- Quotes & signals: `stock_quote 600000`, `stock_kline 000001`, `strategy 300750`
- Personality first: `stock_profile 600000` (recognizes the stock's character and recommends matched strategies, with backtests)
- Hotspots: `sector_rank`, `limit_up_pool`, `dragon_tiger`
- Backtests: `backtest 600519 strategy ma_cross`
- Alerts: `watch_start` (polls the watchlist every 30 s; alerts on moves, limit up/down and volume spikes), `watch_alerts` to read the log

## Project layout

```
├── index.js                # host entry: registers 21 tools + exports the Config schema
├── src/                    # data / quant / watch / config (plain ESM JS)
│   ├── eastmoney.js        # Eastmoney HTTP: quotes, sectors, limit-up pool, money flow
│   ├── tencent.js          # Tencent adjusted K-lines
│   ├── akshare.js          # Python subprocess JSON-RPC (dragon-tiger list, financials)
│   ├── quant.js            # 6-strategy backtest + signal dashboard
│   ├── profile.js          # stock personality recognition + strategy matching
│   ├── config.js           # Config schema (12 volatile fields) + resolveConfig
│   └── watch.js store.js notify.js http.js news.js indicators.js
├── py/akshare_adapter.py   # akshare stdin/stdout JSON-RPC
├── lib/client.js           # settings card bundle (hand-written, committed)
├── scripts/verify.mjs      # `pnpm build` = syntax + contract gate
└── cordis.patch.yml        # plugin mount row
```

## License

[MIT](./LICENSE)

---

# dsh-fire-stock（中文版）

A 股行情 / 热点 / 量化分析助手 —— [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件。

数据源：东方财富公开接口（行情、板块、涨停池、资金流、新闻）+ 腾讯行情（前复权 K 线）+ akshare（龙虎榜、财务摘要）。

> ⚠️ 数据来自非官方公开接口，仅供学习研究，**不构成投资建议**。

## 功能

注册 21 个模型工具、一个独立设置页 **「股票助手」**、盯盘告警（会话日志 + Windows 桌面气泡通知）。

| 分类 | 工具 |
|---|---|
| 行情分析 | `stock_quote` `stock_kline` `stock_indicators` `strategy` |
| 股性识别 | `stock_profile`（股性识别 + 策略匹配 + 自动回测推荐策略） |
| 热点 | `sector_rank` `sector_flow` `limit_up_pool` `dragon_tiger` |
| 资金·财务·新闻 | `stock_flow` `stock_finance` `stock_news` |
| 量化 | `screen`（多因子条件选股）`backtest`（6 策略回测） |
| 自选·盯盘 | `watchlist_add` `watchlist_remove` `watchlist_show` `watch_start` `watch_stop` `watch_status` `watch_alerts` |

设置页（设置 → **股票助手**）可编辑自选股、回测参数、策略参数与盯盘阈值；修改后点右下角「保存」生效，「初始化」恢复全部默认值。策略参数按策略分组显示（如「RSI 超卖反弹」小标题）。

## 安装

前置依赖：

- Node.js ≥ 18（构建客户端 bundle 需要）
- Python 3 + [akshare](https://github.com/akfamily/akshare)（仅 `dragon_tiger`、`stock_finance` 两个工具需要；`pip install akshare`）
- Windows：桌面气泡通知仅 Windows 可用（其他平台自动跳过）

### 方式一：从 GitHub 直接安装

```sh
dsh plugin --profile web add github:SsiriYang/dsh-fire-stock
```

> 推荐固定到某个 commit（更稳妥）：`dsh plugin --profile web add git+https://github.com/SsiriYang/dsh-fire-stock.git#<commit>`

### 方式二：本地开发

```sh
git clone https://github.com/SsiriYang/dsh-fire-stock.git
cd dsh-fire-stock
pnpm install
pnpm build        # 只做校验，不打包（见下方说明）

# 从 DSH checkout 安装（junction 直连源码目录，改完即时可见）
cd <path-to>/deepseek-harness
pnpm dsh plugin --profile web add <path-to>/dsh-fire-stock
```

> ⚠️ `lib/client.js` 是**手写源码**，不是构建产物，已直接提交进仓库，**不要重新生成**：它针对 DSH 0.2.x 的客户端 API（`ctx.configForms`、`plugins.item` / `settings.section` 槽位）。`pnpm build` 只跑 `scripts/verify.mjs`——对全部运行时代码做语法检查，并断言 bundle 的契约（模块 id、槽位、字典命名空间、包名、patch id），所以一旦 bundle 陈旧或被改坏，build 会失败，而不是等到用户重启后设置卡片静默消失。
>
> `package.json` 声明了 `exports["./client"]`，`lib/client.js` 必须存在，否则 web 启动页报 `Failed to load plugins`。该文件已提交，GitHub 安装无需任何构建步骤。

## 使用

把股票加入自选（对话里用工具或设置页都行），然后：

- 问行情：`stock_quote 600000`、`stock_kline 000001`、`strategy 300750`
- 先看股性：`stock_profile 600000`（识别股性并推荐匹配策略，附带自动回测对比）
- 看热点：`sector_rank`、`limit_up_pool`、`dragon_tiger`
- 做回测：`backtest 600519 strategy ma_cross`
- 开盯盘：`watch_start`（30 秒轮询自选股，异动/涨停/放量告警），`watch_alerts` 看日志

## 项目结构

```
├── index.js                # 宿主入口：注册 21 个工具 + 导出 Config schema
├── src/                    # 数据/量化/盯盘/配置（纯 ESM JS）
│   ├── eastmoney.js        # 东财 HTTP：行情/板块/涨停池/资金流
│   ├── tencent.js          # 腾讯前复权 K 线
│   ├── akshare.js          # Python 子进程 JSON-RPC（龙虎榜/财务）
│   ├── quant.js            # 6 策略回测 + 多空信号
│   ├── profile.js          # 股性识别 + 策略匹配
│   ├── config.js           # 配置 schema（12 个 volatile 字段）+ resolveConfig
│   └── watch.js store.js notify.js http.js news.js indicators.js
├── py/akshare_adapter.py   # akshare stdin/stdout JSON-RPC
├── lib/client.js           # 设置卡片 bundle（手写，提交进仓库）
├── scripts/verify.mjs      # `pnpm build` = 语法与契约校验
└── cordis.patch.yml        # 插件挂载行
```

## License

[MIT](./LICENSE)
