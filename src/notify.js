// 桌面通知：Windows 气泡提示（NotifyIcon），依赖无关、fire-and-forget。
// 标题/正文用 base64 编码传递，规避中文与特殊字符的引号转义问题。
import { spawn } from 'node:child_process'

function b64(s) {
  return Buffer.from(String(s), 'utf8').toString('base64')
}

/**
 * 弹出一个 Windows 桌面气泡通知。
 * @param {string} title 标题
 * @param {string} message 正文
 * @returns {boolean} 是否发起（非 win32 返回 false）
 */
export function notify(title, message) {
  if (process.platform !== 'win32') return false
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$n = New-Object System.Windows.Forms.NotifyIcon',
    '$n.Icon = [System.Drawing.SystemIcons]::Warning',
    `$n.BalloonTipTitle = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(title)}'))`,
    `$n.BalloonTipText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(message)}'))`,
    '$n.Visible = $true',
    '$n.ShowBalloonTip(5000)',
    'Start-Sleep -Milliseconds 800',
    '$n.Dispose()',
  ].join('; ')
  const child = spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { stdio: 'ignore' })
  child.on('error', () => {})
  return true
}
