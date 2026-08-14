import type { Category } from "./classify.js"
import type { Action, Trust } from "./types.js"

/**
 * 三档信任矩阵。**红线优先于本表**——本表只回答「没踩红线时按档位该怎么办」。
 *
 * `unknown` 的取值是有意保守的：新引擎的新工具名会落到这里，
 * 在 read-only / auto-edit 下宁可多问一次，也不漏判。
 */
const MATRIX: Readonly<Record<Trust, Readonly<Record<Category, Action>>>> = {
  "read-only": {
    read: "allow",
    write: "deny",
    exec: "deny",
    net: "deny",
    meta: "allow",
    unknown: "deny",
  },
  "auto-edit": {
    read: "allow",
    write: "allow",
    exec: "allow",
    net: "escalate",
    meta: "allow",
    unknown: "escalate",
  },
  full: {
    read: "allow",
    write: "allow",
    exec: "allow",
    net: "allow",
    meta: "allow",
    unknown: "allow",
  },
}

const DENY_REASON: Readonly<Record<Trust, string>> = {
  "read-only": "当前会话是只读档，不能写文件、执行命令或访问网络。如需继续请让用户升档",
  "auto-edit": "当前档位不允许该动作",
  full: "当前档位不允许该动作",
}

const FALLBACK_REASON = "当前档位不允许该动作"

export function trustVerdict(trust: Trust, category: Category): { action: Action; reason: string } {
  // `?? "escalate"` 是防御性的：档位或类别将来加了新取值而这里忘了补，
  // 表现是「多问一次」而不是「静默放行」。
  const action = MATRIX[trust]?.[category] ?? "escalate"
  if (action === "allow") return { action, reason: "" }
  if (action === "deny") return { action, reason: DENY_REASON[trust] ?? FALLBACK_REASON }
  return { action, reason: "该动作超出当前档位的自动放行范围，等待用户确认" }
}
