import { defineMessages } from "@switchback/i18n"

/** codex 申请额外权限时审批卡上那句。路径原样显示。 */
export const CODEX_PERMISSIONS = defineMessages(
  {
    shown: (head: readonly string[], total: number) => `${head.join("、")}${total > head.length ? ` 等 ${String(total)} 项` : ""}`,
    network: "访问网络",
    read: (paths: string) => `读取 ${paths}`,
    write: (paths: string) => `写入 ${paths}`,
    reason: (text: string) => ` （${text}）`,
    noDetail: "Codex 申请额外权限（详情未送达）",
    asks: (parts: readonly string[]) => `Codex 申请额外权限：${parts.join("；")}`,
  },
  {
    shown: (head, total) => `${head.join(", ")}${total > head.length ? ` and ${String(total - head.length)} more` : ""}`,
    network: "access the network",
    read: (paths) => `read ${paths}`,
    write: (paths) => `write ${paths}`,
    reason: (text) => ` (${text})`,
    noDetail: "Codex is asking for extra permissions (details not provided)",
    asks: (parts) => `Codex is asking for extra permissions: ${parts.join("; ")}`,
  },
)
