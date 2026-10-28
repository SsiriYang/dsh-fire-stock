// 构建校验（build 入口）。
//
// 背景：本插件的客户端一半是**手写并提交进仓库**的 IIFE 产物 lib/client.js，
// 格式为 window.__ModuleLoader__.load({ id, factory })。它没有 TSX 源码、也不该被
// 打包器重新生成 —— 早期那份 src/client/*.tsx 依赖已被 DSH 0.2.x 删除的
// settingsScope API，一旦被构建覆盖，设置页卡片就会静默消失。
//
// 所以这里不做打包，只做两件事：
//   1) 对全部运行时代码做语法检查；
//   2) 校验客户端 bundle 与包元数据的契约（模块 id、槽位、命名空间、包名、patch id）。
// 任何一项不满足即失败退出，让问题在 build 阶段暴露，而不是等用户重启后才发现。

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const problems = []
const ok = []

function checkSyntax(rel) {
  const abs = join(root, rel)
  if (!existsSync(abs)) {
    problems.push(`缺少文件：${rel}`)
    return
  }
  try {
    execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' })
    ok.push(`语法通过：${rel}`)
  } catch (e) {
    const detail = (e.stderr?.toString() || e.message || '').trim().split('\n').slice(0, 3).join(' / ')
    problems.push(`语法错误：${rel} —— ${detail}`)
  }
}

function expectContains(rel, needle, why) {
  const abs = join(root, rel)
  if (!existsSync(abs)) {
    problems.push(`缺少文件：${rel}`)
    return
  }
  const text = readFileSync(abs, 'utf8')
  if (text.includes(needle)) ok.push(`${rel} 含 ${needle}`)
  else problems.push(`${rel} 缺少 ${needle}（${why}）`)
}

function expectAbsent(rel, needle, why) {
  const abs = join(root, rel)
  if (!existsSync(abs)) {
    problems.push(`缺少文件：${rel}`)
    return
  }
  const text = readFileSync(abs, 'utf8')
  if (!text.includes(needle)) ok.push(`${rel} 不含 ${needle}`)
  else problems.push(`${rel} 仍含 ${needle}（${why}）`)
}

// 1) 语法
checkSyntax('index.js')
checkSyntax('lib/client.js')
for (const f of readdirSync(join(root, 'src')).filter((n) => n.endsWith('.js'))) {
  checkSyntax(join('src', f))
}

// 2) 客户端 bundle 契约（DSH 0.2.1-rc.3）
expectContains('lib/client.js', 'window.__ModuleLoader__.load', '客户端必须用模块加载器注册')
expectContains('lib/client.js', 'id: "dsh-fire-stock"', '模块 id 必须与包名一致')
expectContains('lib/client.js', 'plugins.item', '设置页卡片挂在插件页')
expectContains('lib/client.js', 'whileServed', '卡片必须用 configForms.whileServed 门控命名空间')
expectContains('lib/client.js', 'settings.fireStock', '本地字典命名空间')
expectContains('lib/client.js', 'dsh-fire-stock', '配置命名空间必须是包名')
// settings.section 只接受「整页设置」，塞进去的插件卡片拿不到 useXxxCard 之类的注入属性，
// 会在页面上渲染成一行报错文本 —— 必须只走 plugins.item。
expectAbsent('lib/client.js', 'settings.section', '设置分区不再注册第二份，否则设置页多一个报错页')

// 2b) 宿主配置读取契约（DSH 0.2.1-rc.3 没有 config 服务）
expectAbsent('index.js', "ctx.inject(['config']", '宿主没有 config 服务，注入它永远不触发，设置项会全部失效')
expectContains('index.js', 'ctx.fiber', '配置必须从插件自己的 fiber 读取（volatile 字段原地更新）')

// 2c) 显示资源（插件页的标题、描述与图标）
for (const rel of ['locale/zh.json', 'locale/en.json']) {
  if (!existsSync(join(root, rel))) {
    problems.push(`缺少文件：${rel}`)
    continue
  }
  try {
    const meta = JSON.parse(readFileSync(join(root, rel), 'utf8')).meta
    if (!meta?.title || !meta?.description) problems.push(`${rel} 缺少 meta.title / meta.description`)
    else ok.push(`${rel} 含 meta.title 与 meta.description`)
  } catch (e) {
    problems.push(`${rel} 不是合法 JSON：${e.message}`)
  }
}
if (!existsSync(join(root, 'icon.svg'))) problems.push('缺少文件：icon.svg')
else ok.push('icon.svg 存在')

// 3) 包元数据契约
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (pkg.name !== 'dsh-fire-stock') problems.push(`package.json name 应为 dsh-fire-stock，实际 ${pkg.name}`)
else ok.push('package.json name = dsh-fire-stock')
if (!pkg.dsh?.bundle?.patch) problems.push('package.json 缺少 dsh.bundle.patch（宿主不会插入本插件）')
else ok.push('package.json 含 dsh.bundle.patch')
if (pkg.dsh?.client?.platform !== 'web') problems.push('package.json 缺少 dsh.client.platform = web')
else ok.push('package.json 含 dsh.client.platform = web')
if (pkg.main !== 'index.js') problems.push(`package.json main 应为 index.js，实际 ${pkg.main}`)
else ok.push('package.json main = index.js')

// 4) patch 层 id 必须与包名一致（否则设置命名空间对不上）
expectContains('cordis.patch.yml', 'id: dsh-fire-stock', 'bundle patch 的条目 id')
expectContains('cordis.patch.yml', "name: 'dsh-fire-stock'", 'bundle patch 的条目 name')

// 5) 兜底：确认没有残留旧名（旧名会让设置页静默失效）
for (const rel of ['index.js', 'lib/client.js', 'package.json', 'cordis.patch.yml']) {
  const text = readFileSync(join(root, rel), 'utf8')
  for (const stale of ['dsh-fire-stock-assistant', 'dsh-stock-assistant']) {
    if (text.includes(stale)) problems.push(`${rel} 仍含已废弃标识 ${stale}`)
  }
}

if (/ctx\.settingsScope/.test(readFileSync(join(root, 'index.js'), 'utf8'))) problems.push('index.js 仍调用 ctx.settingsScope（DSH 0.2.x 已删除该 API）')

console.log(ok.map((l) => `  ✔ ${l}`).join('\n'))
if (problems.length > 0) {
  console.error('\n构建校验失败：')
  for (const p of problems) console.error(`  ✘ ${p}`)
  process.exit(1)
}
console.log(`\n构建校验通过（${ok.length} 项）。客户端产物 lib/client.js 为手写源码，无需打包。`)
