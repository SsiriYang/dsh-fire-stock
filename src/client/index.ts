// 客户端入口：在「设置」里注册独立的「股票助手」设置页（settings.section 槽位）。
// 之前注册在 settings.plugin.item（内嵌于「插件 → 插件配置」页签），
// 现改为独立导航项：id 驱动 only 过滤，order 控制排序，label 为导航文案。
import { SettingsCard } from './SettingsCard'

export const inject = ['slots', 'settingsScope']

export function apply(ctx: any): void {
  const scope = ctx.settingsScope.bind({ namespace: 'stock-assistant' })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'stock-assistant',
    order: 20,
    label: () => '股票助手',
    inject: () => ({ scope }),
  }, SettingsCard))
}
