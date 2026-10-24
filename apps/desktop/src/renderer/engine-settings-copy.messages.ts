import { defineMessages } from "@switchback/i18n"

/** 设置 → 引擎：每家一句「谁管什么」，以及去它自己那扇门的标题与提示。命令本身不翻译，在 `engine-settings-copy.ts`。 */
export const ENGINE_COPY = defineMessages(
  {
    summary: {
      claude: "账号、权限、Hooks 与项目规则仍由 Claude Code 管；Switchback 保存新会话怎么起。",
      codex: "账号、沙箱、审批与功能开关仍由 Codex 管；Switchback 保存新会话怎么起。",
      kimi: "Provider、模型与凭证仍由 Kimi Code 管；Switchback 使用它公开的运行接口。",
      grok: "账号、模型与原生偏好仍由 Grok 管；Switchback 使用它自带的 Agent Mode。",
      dsh: "选择 DSH profile 作为插件组装边界；能力、Provider、模型与凭证仍由这棵插件树自己报告和管理。",
    },
    nativeTitle: {
      claude: "认证与账户",
      codex: "认证与账户",
      kimi: "Provider 与模型",
      grok: "认证与账户",
      dsh: "Provider 与模型",
    },
    nativeHint: {
      claude: "登录与凭证由 Claude Code 自己保存；Switchback 不读取密钥。",
      codex: "登录结果进入 Codex 自己的凭证存储；Switchback 不复制 access token。",
      kimi: "在终端运行后，会打开 Kimi Code 自己的浏览器设置界面。",
      grok: "登录与凭证由 Grok 自己保存；Switchback 不读取密钥。",
      dsh: "在终端运行后，到 DSH Web 的 Settings → Models 完成原生配置。",
    },
    acp: "这家通过 engines.json 接入；能力、模型与凭证由它自己的 ACP 实现管理。",
  },
  {
    summary: {
      claude: "Claude Code still manages accounts, permissions, hooks, and project rules; Switchback keeps how new threads start.",
      codex: "Codex still manages accounts, the sandbox, approvals, and feature flags; Switchback keeps how new threads start.",
      kimi: "Kimi Code still manages providers, models, and credentials; Switchback uses the runtime interface it publishes.",
      grok: "Grok still manages accounts, models, and its native preferences; Switchback uses its built-in Agent Mode.",
      dsh: "The DSH profile you pick is where plugins are assembled; that plugin tree still reports and manages its own capabilities, providers, models, and credentials.",
    },
    nativeTitle: {
      claude: "Authentication and account",
      codex: "Authentication and account",
      kimi: "Providers and models",
      grok: "Authentication and account",
      dsh: "Providers and models",
    },
    nativeHint: {
      claude: "Claude Code stores sign-ins and credentials itself; Switchback doesn't read keys.",
      codex: "Sign-ins go into Codex's own credential store; Switchback doesn't copy access tokens.",
      kimi: "Run it in a terminal and it opens Kimi Code's own settings page in the browser.",
      grok: "Grok stores sign-ins and credentials itself; Switchback doesn't read keys.",
      dsh: "Run it in a terminal, then finish the native setup under Settings → Models in DSH Web.",
    },
    acp: "This one is connected through engines.json; its own ACP implementation manages capabilities, models, and credentials.",
  },
)
