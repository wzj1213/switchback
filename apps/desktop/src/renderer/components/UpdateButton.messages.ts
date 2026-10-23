import { defineMessages } from "@switchback/i18n"

/** 侧栏底部那颗「更新到最新代码」（只在源码检出里跑的那份应用上出现）。 */
export const UPDATE_BUTTON = defineMessages(
  {
    update: "更新到最新代码",
    retry: "构建失败，再试一次",
    failedTip: (output: string) => `构建失败，点一下重试：\n${output}`,
    running: "正在跑 pnpm dist:local，跑完自动换包并重开。第一次大约十几秒。",
    newer: (version: string) => `${version} 比装着的这份新`,
    how: "点一下：pnpm dist:local → 换掉 /Applications/Switchback.app → 自动重开",
    warn: "（会退出重开，正在跑的那一轮会断）",
  },
  {
    update: "Update to the latest code",
    retry: "Build failed. Try again",
    failedTip: (output) => `Build failed. Click to retry:\n${output}`,
    running: "Running pnpm dist:local. When it finishes, the app is replaced and reopens. The first run takes a dozen seconds or so.",
    newer: (version) => `${version} is newer than the installed copy`,
    how: "Click: pnpm dist:local → replace /Applications/Switchback.app → reopen",
    warn: "(The app quits and reopens, so a running turn is interrupted.)",
  },
)
