import type { BuiltinEngineId } from "../shared/builtin-engines.js"

export interface EngineSettingsCopy {
  summary: string
  native?: {
    title: string
    command: string
    hint: string
  }
}

const COPY: Readonly<Record<BuiltinEngineId, EngineSettingsCopy>> = {
  claude: {
    summary: "账号、权限、Hooks 与项目规则仍由 Claude Code 管；omni 保存新会话怎么起。",
    native: {
      title: "认证与账户",
      command: "claude auth",
      hint: "登录与凭证由 Claude Code 自己保存；omni 不读取密钥。",
    },
  },
  codex: {
    summary: "账号、沙箱、审批与功能开关仍由 Codex 管；omni 保存新会话怎么起。",
    native: {
      title: "认证与账户",
      command: "codex login",
      hint: "登录结果进入 Codex 自己的凭证存储；omni 不复制 access token。",
    },
  },
  kimi: {
    summary: "Provider、模型与凭证仍由 Kimi Code 管；omni 使用它公开的运行接口。",
    native: {
      title: "Provider 与模型",
      command: "kimi web",
      hint: "在终端运行后，会打开 Kimi Code 自己的浏览器设置界面。",
    },
  },
  grok: {
    summary: "账号、模型与原生偏好仍由 Grok 管；omni 使用它自带的 Agent Mode。",
    native: {
      title: "认证与账户",
      command: "grok login",
      hint: "登录与凭证由 Grok 自己保存；omni 不读取密钥。",
    },
  },
  dsh: {
    summary: "选择 DSH profile 作为插件组装边界；能力、Provider、模型与凭证仍由这棵插件树自己报告和管理。",
    native: {
      title: "Provider 与模型",
      command: "dsh web",
      hint: "在终端运行后，到 DSH Web 的 Settings → Models 完成原生配置。",
    },
  },
}

export function settingsCopyOf(id: string): EngineSettingsCopy {
  return (
    COPY[id as BuiltinEngineId] ?? {
      summary: "这家通过 engines.json 接入；能力、模型与凭证由它自己的 ACP 实现管理。",
    }
  )
}
