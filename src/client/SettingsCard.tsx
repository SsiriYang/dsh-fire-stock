// 股票助手设置页：自选股 + 回测参数 + 策略参数（按策略分组）+ 盯盘参数。
// 交互模型：所有修改只写入本地草稿（可自由输入数值），点右下角「保存」统一提交
// （scope.mutate 一次原子写入全部字段）；「初始化」把草稿恢复为默认值（也需点保存生效）。
import { useEffect, useState, useSyncExternalStore } from 'react'

function useScope(scope: any): any {
  return useSyncExternalStore(
    (cb: () => void) => scope.subscribe(cb),
    () => scope.getSnapshot(),
  )
}

type WatchItem = { code: string; name: string }

interface FieldDef {
  field: string
  label: string
  step: number
  min?: number
  max?: number
}

/** 全部数值字段定义（顺序 = 渲染顺序）。 */
const FIELDS: FieldDef[] = [
  { field: 'backtestCount', label: '回测 K 线根数', step: 1, min: 40, max: 800 },
  { field: 'initialCapital', label: '初始资金（元）', step: 1000, min: 1000 },
  { field: 'maFast', label: '均线快线', step: 1, min: 2, max: 100 },
  { field: 'maSlow', label: '均线慢线', step: 1, min: 3, max: 250 },
  { field: 'rsiPeriod', label: 'RSI 周期', step: 1, min: 2, max: 100 },
  { field: 'rsiOversold', label: 'RSI 超卖阈值', step: 1, min: 1, max: 50 },
  { field: 'rsiOverbought', label: 'RSI 超买阈值', step: 1, min: 50, max: 99 },
  { field: 'kdjPeriod', label: 'KDJ 周期', step: 1, min: 2, max: 100 },
  { field: 'breakoutPeriod', label: '突破周期（N 日）', step: 1, min: 2, max: 250 },
  { field: 'bollPeriod', label: '布林带周期', step: 1, min: 2, max: 250 },
  { field: 'watchChangePct', label: '涨跌幅阈值（%）', step: 0.5, min: 0.5, max: 20 },
  { field: 'watchVolumeRatio', label: '放量倍数', step: 0.5, min: 1, max: 20 },
]

const FIELD_LABELS: Record<string, string> = Object.fromEntries(FIELDS.map((f) => [f.field, f.label]))

/** 策略分组：每个策略一个三级小标题，其下是策略参数。 */
const STRATEGY_GROUPS: Array<{ title: string; fields: string[] }> = [
  { title: '均线金叉/死叉', fields: ['maFast', 'maSlow'] },
  { title: 'RSI 超卖反弹', fields: ['rsiPeriod', 'rsiOversold', 'rsiOverbought'] },
  { title: 'KDJ 金叉/死叉', fields: ['kdjPeriod'] },
  { title: 'N日突破', fields: ['breakoutPeriod'] },
  { title: '布林带回归', fields: ['bollPeriod'] },
]

interface Draft {
  nums: Record<string, string>
  watchlist: WatchItem[]
}

function buildDraft(source: any): Draft {
  const nums: Record<string, string> = {}
  for (const f of FIELDS) {
    const v = source?.[f.field]
    nums[f.field] = v == null || v === '' ? '' : String(v)
  }
  return {
    nums,
    watchlist: Array.isArray(source?.watchlist)
      ? source.watchlist.map((w: any) => ({ code: String(w.code ?? ''), name: String(w.name ?? '') }))
      : [],
  }
}

/** 数字输入行：自由输入文本，保存时再校验/解析。 */
function NumField(props: { field: string; label: string; value: string; writable: boolean; invalid: boolean; onChange: (v: string) => void }) {
  const { field, label, value, writable, invalid, onChange } = props
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <input
        id={`stock-field-${field}`}
        type="text"
        inputMode="decimal"
        disabled={!writable}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, ...(invalid ? { borderColor: '#e5484d' } : {}) }}
      />
    </label>
  )
}

export function SettingsCard(props: any) {
  const { scope } = props
  const snapshot = useScope(scope)
  const status = snapshot.status
  const writable = snapshot.writable

  const [draft, setDraft] = useState<Draft | null>(null)
  const [newCode, setNewCode] = useState('')
  const [msg, setMsg] = useState<{ text: string; kind: 'info' | 'error' } | null>(null)
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})

  // 快照就绪 / 版本变化（保存成功或外部修改）时，用当前值重建草稿。
  useEffect(() => {
    if (status !== 'ready') return
    setDraft(buildDraft(snapshot.value))
    setNewCode('')
    setInvalid({})
  }, [status, snapshot.revision])

  if (status === 'unavailable') {
    return <div style={boxStyle}>股票助手配置不可用（命名空间未暴露或连接为内存模式）。</div>
  }
  if (status !== 'ready' || draft === null) {
    return <div style={boxStyle}>加载中…</div>
  }

  const patchNum = (field: string, raw: string) => {
    setMsg(null)
    setDraft((d) => (d === null ? d : { ...d, nums: { ...d.nums, [field]: raw } }))
    const def = FIELDS.find((f) => f.field === field)
    const trimmed = raw.trim()
    const v = trimmed === '' ? NaN : Number(trimmed)
    let bad = false
    if (trimmed !== '' && !Number.isFinite(v)) bad = true
    if (!bad && trimmed !== '' && def?.min != null && v < def.min) bad = true
    if (!bad && trimmed !== '' && def?.max != null && v > def.max) bad = true
    setInvalid((prev) => ({ ...prev, [field]: bad }))
  }

  const addStock = () => {
    const code = newCode.trim()
    if (!code) return
    if (!draft.watchlist.some((w) => w.code === code)) {
      setMsg(null)
      setDraft((d) => (d === null ? d : { ...d, watchlist: [...d.watchlist, { code, name: '' }] }))
    }
    setNewCode('')
  }
  const removeStock = (code: string) => {
    setMsg(null)
    setDraft((d) => (d === null ? d : { ...d, watchlist: d.watchlist.filter((w) => w.code !== code) }))
  }

  const resetToDefaults = () => {
    setMsg({ text: '已恢复初始值，点击「保存」生效', kind: 'info' })
    setDraft(buildDraft(snapshot.base))
    setInvalid({})
  }

  const save = async () => {
    const badField = FIELDS.find((f) => invalid[f.field])
    if (badField !== undefined) {
      setMsg({ text: `「${FIELD_LABELS[badField.field]}」数值无效，请检查`, kind: 'error' })
      return
    }
    const ops: Array<{ op: 'set'; path: string[]; value: unknown }> = []
    for (const f of FIELDS) {
      const raw = draft.nums[f.field].trim()
      if (raw === '') continue // 留空 = 不改动该字段
      ops.push({ op: 'set', path: [f.field], value: Number(raw) })
    }
    ops.push({ op: 'set', path: ['watchlist'], value: draft.watchlist })
    const revBefore = scope.getSnapshot().revision
    if (typeof scope.mutate === 'function') {
      await scope.mutate(ops)
    } else {
      for (const op of ops) await scope.set(op.path[0], op.value)
    }
    const revAfter = scope.getSnapshot().revision
    if (revAfter !== revBefore) {
      setMsg({ text: '已保存', kind: 'info' })
    } else {
      setMsg({ text: '保存未生效：请检查数值是否在允许范围内', kind: 'error' })
    }
  }

  return (
    <div style={boxStyle}>
      <div style={mainTitleStyle}>股票助手</div>
      <div style={descStyle}>修改后点右下角「保存」生效；「初始化」恢复全部默认值。</div>

      {/* 自选股 */}
      <div style={sectionStyle}>自选股</div>
      <div style={{ marginBottom: 8 }}>
        {draft.watchlist.length === 0 && <div style={emptyHintStyle}>（暂无自选股）</div>}
        {draft.watchlist.map((w) => (
          <div key={w.code} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: 'monospace' }}>{w.code}</span>
            <span style={{ color: '#666' }}>{w.name || '—'}</span>
            <button type="button" disabled={!writable} onClick={() => removeStock(w.code)} style={miniBtnStyle}>移除</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          placeholder="输入 6 位代码，如 600000"
          disabled={!writable}
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button type="button" disabled={!writable} onClick={addStock} style={btnStyle}>添加</button>
      </div>

      {/* 回测参数 */}
      <div style={sectionStyle}>回测参数</div>
      <NumField field="backtestCount" label="回测 K 线根数" value={draft.nums.backtestCount} writable={writable} invalid={!!invalid.backtestCount} onChange={(v) => patchNum('backtestCount', v)} />
      <NumField field="initialCapital" label="初始资金（元）" value={draft.nums.initialCapital} writable={writable} invalid={!!invalid.initialCapital} onChange={(v) => patchNum('initialCapital', v)} />

      {/* 策略参数（按策略分组） */}
      <div style={sectionStyle}>策略参数</div>
      {STRATEGY_GROUPS.map((g) => (
        <div key={g.title}>
          <div style={groupTitleStyle}>{g.title}</div>
          {g.fields.map((f) => (
            <NumField key={f} field={f} label={FIELD_LABELS[f]} value={draft.nums[f]} writable={writable} invalid={!!invalid[f]} onChange={(v) => patchNum(f, v)} />
          ))}
        </div>
      ))}

      {/* 盯盘参数 */}
      <div style={sectionStyle}>盯盘参数</div>
      <NumField field="watchChangePct" label="涨跌幅阈值（%）" value={draft.nums.watchChangePct} writable={writable} invalid={!!invalid.watchChangePct} onChange={(v) => patchNum('watchChangePct', v)} />
      <NumField field="watchVolumeRatio" label="放量倍数" value={draft.nums.watchVolumeRatio} writable={writable} invalid={!!invalid.watchVolumeRatio} onChange={(v) => patchNum('watchVolumeRatio', v)} />

      {/* 底部操作条：初始化 + 保存（右下角） */}
      <div style={footerStyle}>
        <span style={{ ...msgStyle, ...(msg?.kind === 'error' ? { color: '#e5484d' } : {}) }}>{msg?.text ?? ''}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={!writable} onClick={resetToDefaults} style={btnStyle}>初始化</button>
          <button type="button" disabled={!writable} onClick={save} style={saveBtnStyle}>保存</button>
        </div>
      </div>
    </div>
  )
}

const boxStyle: React.CSSProperties = { padding: '16px 20px', fontSize: 14, color: 'inherit' }
// 一级标题：股票助手
const mainTitleStyle: React.CSSProperties = { fontSize: 20, fontWeight: 700, marginBottom: 4 }
const descStyle: React.CSSProperties = { fontSize: 12, color: '#888', marginBottom: 12 }
// 二级标题：自选股 / 回测参数 / 策略参数 / 盯盘参数
const sectionStyle: React.CSSProperties = {
  fontSize: 16, fontWeight: 600, margin: '20px 0 10px',
  borderTop: '1px solid rgba(128,128,128,.25)', paddingTop: 12,
}
// 三级标题：单个策略名（如「RSI 超卖反弹」），颜色与正文一致
const groupTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 600, margin: '12px 0 6px', color: 'var(--dsw-alias-label-primary)',
}
const emptyHintStyle: React.CSSProperties = { color: '#888', fontSize: 13 }
// 参数行：参数名（第三级，13px），颜色与官方设置卡的小字体一致
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }
const labelStyle: React.CSSProperties = { flex: 1, fontSize: 13, color: 'var(--dsw-alias-label-primary)' }
const inputStyle: React.CSSProperties = {
  width: 140, padding: '5px 10px', borderRadius: 6,
  border: '1px solid rgba(128,128,128,.45)', background: 'rgba(128,128,128,.06)',
  color: 'inherit', fontSize: 13, textAlign: 'right',
}
const btnStyle: React.CSSProperties = {
  padding: '5px 14px', borderRadius: 6, border: '1px solid rgba(128,128,128,.45)',
  background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13,
}
const saveBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#5b5bd6', borderColor: '#5b5bd6', color: '#fff', fontWeight: 600,
  padding: '5px 22px',
}
const miniBtnStyle: React.CSSProperties = { ...btnStyle, padding: '2px 8px', fontSize: 12 }
const footerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
  marginTop: 24, paddingTop: 14, borderTop: '1px solid rgba(128,128,128,.25)',
}
const msgStyle: React.CSSProperties = { fontSize: 12, color: '#8fae8f', marginRight: 'auto' }
