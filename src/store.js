// 本地 JSON 持久化：自选股列表 + 告警日志 + IM 提醒目标。
// 存放于 $DSH_HOME/storages/stock-assistant.json（无 DSH_HOME 时回退到 ~/.dsh）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

function baseDir() {
  const dsh = process.env.DSH_HOME
  if (dsh) return join(dsh, 'storages')
  return join(homedir(), '.dsh', 'storages')
}

export function createStore(filename = 'stock-assistant.json') {
  const file = join(baseDir(), filename)
  const initial = { watchlist: [], alerts: [], imTarget: null }

  function load() {
    try {
      return { ...initial, ...JSON.parse(readFileSync(file, 'utf8')) }
    } catch {
      return { ...initial }
    }
  }

  function save(data) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
  }

  return {
    file,
    getWatchlist() {
      return load().watchlist || []
    },
    getWatch() {
      return load().watch || { enabled: false, rules: {} }
    },
    setWatch(watch) {
      const d = load()
      d.watch = watch
      save(d)
      return d.watch
    },
    setWatchlist(watchlist) {
      const d = load()
      d.watchlist = watchlist
      save(d)
      return d.watchlist
    },
    /** 最近一次 IM 推送结果：{ at, ok, via, error }，用于设置页/状态排查。 */
    getLastPush() {
      return load().lastPush || null
    },
    setLastPush(result) {
      const d = load()
      d.lastPush = result || null
      save(d)
      return d.lastPush
    },
    /** 盯盘告警的 IM 投递目标：{ botId, toUserId, targetId?, name } 或 null。 */
    getImTarget() {
      return load().imTarget || null
    },
    setImTarget(target) {
      const d = load()
      d.imTarget = target || null
      save(d)
      return d.imTarget
    },
    appendAlert(alert) {
      const d = load()
      d.alerts = [alert, ...(d.alerts || [])].slice(0, 500)
      save(d)
      return alert
    },
    getAlerts(limit = 50) {
      return (load().alerts || []).slice(0, limit)
    },
  }
}
