// 本地 JSON 持久化：自选股列表 + 告警日志。
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
  const initial = { watchlist: [], alerts: [] }

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
