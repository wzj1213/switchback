import { defineMessages } from "@switchback/i18n"

/** Claude 同步配置里的插件时的提示。插件来源名与报错原样显示。 */
export const CLAUDE_PLUGINS = defineMessages(
  {
    syncing: "Claude 正在同步配置中的插件…",
    synced: "Claude 插件同步流程已结束",
    sourceSynced: (name: string) => `Claude 已同步插件来源：${name}`,
    failed: "Claude 插件同步失败",
    sourceFailed: (name: string) => `Claude 插件来源同步失败：${name}`,
  },
  {
    syncing: "Claude is syncing the plugins in its config…",
    synced: "Claude finished syncing plugins",
    sourceSynced: (name) => `Claude synced the plugin source: ${name}`,
    failed: "Claude couldn't sync plugins",
    sourceFailed: (name) => `Claude couldn't sync the plugin source: ${name}`,
  },
)
