// akshare Python 子进程适配（Phase 2：资金流明细/龙虎榜/财务等低频数据）。
// 通过 stdin/stdout JSON 协议调用 py/akshare_adapter.py。
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PY = join(here, '..', 'py', 'akshare_adapter.py')
const PYTHON = process.env.PYTHON || process.env.PYTHON3 || 'python'

export function runAkshare(cmd, args = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [PY], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error((err || `akshare 退出码 ${code}`).trim()))
      try {
        const j = JSON.parse(out)
        if (j && j.ok) resolve(j.data)
        else reject(new Error((j && j.error) || 'akshare 返回错误'))
      } catch {
        reject(new Error('akshare 输出解析失败: ' + out.slice(0, 200)))
      }
    })
    child.stdin.write(JSON.stringify({ cmd, args }))
    child.stdin.end()
  })
}
