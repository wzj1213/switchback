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
  /*
   * **`unknown` 要单独说一句。**
   *
   * 它和别的类别不是一回事：别的是「看清了，但这一档不放行」，它是**没看清**。
   * 而 `unknown` 恰好是唯一一个在「自动审批 → 完全访问」之间从 escalate 翻成
   * allow 的类别——于是原来那句笼统的「超出当前档位的自动放行范围」会把人推向
   * 升档，而升到完全访问**确实管用**（`unknown` 翻成 allow）。
   *
   * 那是最不该拉的那根杆：真正的问题是 omni 没认出这条动作是什么
   *（实测 ZCode 的 `tool permission (Bash)` 就是这么落进来的），
   * 该修的是分类，不是把整档权限放开。话说准了，人才不会去拉错的杆。
   *
   * 顺带记一笔：本表能走到 escalate 的只有 `auto-edit` 的 `net` 和 `unknown`
   *（只读全是 allow/deny、完全访问全是 allow），而 `net` **一定先被红线接走**
   *（`network` 那条在这一档 escalate，红线的理由优先）。所以下面那句笼统的话
   * 今天其实没有调用者——它留着是给**将来新增的类别**兜底（`MATRIX` 那句
   * `?? "escalate"` 是同一个用意：忘了补表时多问一次，而不是静默放行）。
   */
  if (category === "unknown") {
    return { action, reason: "omni 没认出这是什么动作（读 / 写 / 执行 / 联网都对不上），所以按最保守的一档处理" }
  }
  return { action, reason: "该动作超出当前档位的自动放行范围，等待用户确认" }
}
