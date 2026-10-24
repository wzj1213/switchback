import { classify } from "./classify.js"
import { matchMemory, suggestRule } from "./memory.js"
import { firstRedline } from "./redline.js"
import { trustVerdict } from "./trust.js"
import type { Request, SessionState, Verdict } from "./types.js"
import type { Locale } from "@switchback/i18n"
import { FALLBACK_LOCALE } from "./locale.js"
import { DECIDE } from "./decide.messages.js"
import { REDLINE } from "./redline.messages.js"

/**
 * 判定管线：normalize → redline → memory → trust。
 *
 * 两条不可调换的次序，各自挡住一类错误：
 *
 * 1. **红线在记忆之前** —— 「以后自动允许」永远无法把红线记没，
 *    除非该红线显式标了 `memorable`（目前只有网络）。
 * 2. **记忆只能把 escalate 变成 allow，永远不能把 deny 变成 allow** ——
 *    档位是地板。read-only 档下即使记过 `pnpm test`，也依然拒绝，
 *    否则「只读」就不是只读了。
 *
 * 这是纯函数：同样的入参永远给同样的结果，没有 IO、没有时钟、没有随机。
 */
export function decide(req: Request, state: SessionState): Verdict {
  const locale = state.locale ?? FALLBACK_LOCALE
  const norm = classify(req, state.home)
  const remembered = matchMemory(norm, req, state.memory)
  const hit = firstRedline({ norm, req, state })

  const floor = trustVerdict(state.trust, norm.category, locale)

  if (hit !== undefined) {
    // **只有 escalate 才能被记忆免掉。** 上面第 2 条不变量原来只写在注释里，
    // 代码判的是 `hit.redline.memorable && remembered`——漏了 `hit.action`。
    // 后果实测：auto-edit 下给 `curl` 记一条「本项目始终允许」，再把档位降到
    // read-only（界面写着「任何写入与命令都拒绝」），同一条 curl 返回 allow；
    // 而放行的是**整条 Bash 命令**，`curl … | sh` 也一起过——
    // 等于只读档任意代码执行。而且不用重开会话：`setTrust` 只改档位、不清规则。
    if (hit.action === "escalate" && hit.redline.memorable && remembered !== undefined) {
      return allowIfFloorPermits(floor, remembered.describe, locale)
    }
    const base: Verdict = { action: hit.action, reason: REDLINE[locale].reason[hit.redline.id], redline: hit.redline.id }
    if (hit.action !== "escalate" || !hit.redline.memorable) return base
    const suggest = suggestRule(norm, hit.redline.id, locale)
    return suggest === undefined ? base : { ...base, suggest }
  }

  if (floor.action !== "escalate") return floor

  if (remembered !== undefined) {
    return allowIfFloorPermits(floor, remembered.describe, locale)
  }
  const suggest = suggestRule(norm, undefined, locale)
  return suggest === undefined ? floor : { ...floor, suggest }
}

/**
 * 记忆命中之后仍要过一遍档位。
 *
 * **记忆只免掉「再问一次」，不免掉档位本身。** 这句话原来只活在注释里，
 * 现在让它在代码里成立：档位说 deny 就还是 deny，记过多少次都一样。
 */
function allowIfFloorPermits(floor: Verdict, describe: string, locale: Locale): Verdict {
  if (floor.action === "deny") return floor
  return { action: "allow", reason: DECIDE[locale].remembered(describe) }
}
