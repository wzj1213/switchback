import { defineMessages } from "@switchback/i18n"

/**
 * 「安装与版本」每一行附的那句说明，按码取。探测结果要缓存几个小时，**存码不存话**：
 * 换了界面语言，下次取的时候就照新语言说（`enginever.ts` 的 `phrased`）。
 */
export const VERSION_NOTE = defineMessages(
  {
    note: {
      "claude-self": "由 Claude 自己检查并安装新版",
      "claude-bundled": "完整版使用随 Switchback 打包的 Claude；更新 Switchback 才会换掉它",
      "npm-latest-unknown": "暂时没查到 npm 上的最新版",
      "other-install": "当前不是 Switchback 验过的 npm 全局安装；为免装出第二份，请用原安装来源更新",
      "grok-where": "grok 由它自己的安装器铺在 ~/.grok 下；装好后确保 grok 在 PATH 上",
      "grok-latest-unknown": "暂时没从 Grok 更新器查到最新版",
      "dsh-where": "DSH 的版本与 profiles 由它自己管理，Switchback 不代装；装好后确保 dsh 在 PATH 上",
      "dsh-self": "版本与 profiles 由 DSH 自己管理，Switchback 不代装插件",
    },
  },
  {
    note: {
      "claude-self": "Claude checks for and installs new versions itself",
      "claude-bundled": "The full edition uses the Claude bundled with Switchback; it changes only when Switchback updates",
      "npm-latest-unknown": "Couldn't get the latest version from npm for now",
      "other-install": "This isn't an npm global install Switchback has verified. To avoid ending up with a second copy, update it from where it was installed",
      "grok-where": "grok's own installer puts it under ~/.grok; once it's installed, make sure grok is on PATH",
      "grok-latest-unknown": "Couldn't get the latest version from Grok's updater for now",
      "dsh-where": "DSH manages its own versions and profiles, and Switchback doesn't install it; once it's installed, make sure dsh is on PATH",
      "dsh-self": "DSH manages its own versions and profiles; Switchback doesn't install plugins for it",
    },
  },
)
