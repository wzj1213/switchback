import { defineMessages } from "@switchback/i18n"

/** 只读档落不到 Antigravity 上时那一句。档位名与界面上的叫法一致。 */
export const AGY_OPTIONS = defineMessages(
  {
    readOnly: "Antigravity 的 plan 是规划模式，不是只读权限；当前公开接口无法落实只读档。请使用原生 CLI 配置权限，或明确选择自动审批 / 完全访问。",
  },
  {
    readOnly: "Antigravity's plan is a planning mode, not a read-only permission, so its public interface can't enforce the Read only tier. Configure permissions in the native CLI, or explicitly choose Auto-approve or Full access.",
  },
)
