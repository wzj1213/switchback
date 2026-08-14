import { classify } from "./classify.js"
import { matchMemory, suggestRule } from "./memory.js"
import { firstRedline } from "./redline.js"
import { trustVerdict } from "./trust.js"
import type { Request, SessionState, Verdict } from "./types.js"

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
  const norm = classify(req, state.home)
  const remembered = matchMemory(norm, req, state.memory)
  const hit = firstRedline({ norm, req, state })

  if (hit !== undefined) {
    if (hit.redline.memorable && remembered !== undefined) {
      return { action: "allow", reason: `已记忆：${remembered.describe}` }
    }
    const base: Verdict = { action: hit.action, reason: hit.redline.reason, redline: hit.redline.id }
    if (hit.action !== "escalate" || !hit.redline.memorable) return base
    const suggest = suggestRule(norm)
    return suggest === undefined ? base : { ...base, suggest }
  }

  const byTrust = trustVerdict(state.trust, norm.category)
  if (byTrust.action !== "escalate") return byTrust

  if (remembered !== undefined) {
    return { action: "allow", reason: `已记忆：${remembered.describe}` }
  }
  const suggest = suggestRule(norm)
  return suggest === undefined ? byTrust : { ...byTrust, suggest }
}
