import { defineMessages } from "@switchback/i18n"

/** 「从源码更新」为什么不能用、做到一半为什么停了。路径和构建输出原样显示。 */
export const SELF_UPDATE = defineMessages(
  {
    devMode: "不是从 .app 跑的（开发模式下改完存盘就生效，用不着这个）",
    noRepo: (repo: string | undefined) => `这个包烤进去的源码路径不在这台机器上：${repo ?? "（没烤）"}`,
    noStamp: (stamp: string) => `找不到 ${stamp}`,
    cannot: "这台机器上不能自更新",
    missing: (bundle: string) => `构建跑完了，但没找到 ${bundle}`,
  },
  {
    devMode: "Not running from a .app (in development mode, saved changes take effect right away, so this isn't needed)",
    noRepo: (repo) => `The source path built into this package isn't on this machine: ${repo ?? "(none built in)"}`,
    noStamp: (stamp) => `Can't find ${stamp}`,
    cannot: "Self-update isn't available on this machine",
    missing: (bundle) => `The build finished, but ${bundle} wasn't found`,
  },
)
