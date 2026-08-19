import type { Thread } from "@omni/protocol"

/**
 * 档位下面那一行说明：**omni 的档和引擎那边对不对得上，对不上是哪一种对不上。**
 *
 * ## 为什么默认什么都不说
 *
 * 档位下拉显示的永远是 **omni 的档**——它是唯一一个「点了就一定生效」的东西：
 * 就算引擎那边接不上，它至少驱动着 omni 本机的审批判定层。引擎的档是个**观测值**，
 * 可能过时、可能读不回来、可能只覆盖一半。所以正常情况下这里返回 `undefined`，
 * 一个字都不多说；只有在**两者确实分家**或**omni 明确没设上**时才出声。
 *
 * ## 为什么是纯函数
 *
 * 这四种情形的措辞是这批的核心产出，每一句都在回答「用户看到之后该干什么」。
 * 放在组件里就只能靠肉眼 review；单拎出来，一张 case 表就能把四种都钉住。
 */
export interface TrustHint {
  kind: "diverged" | "fixed" | "unmapped" | "blind"
  text: string
  /** 有动作可做时给一个。没有动作就别给按钮——一个点了没用的按钮比没有更糟。 */
  action?: { label: string; kind: "reapply" }
}

/** 分家：**此刻正在发生的事实**，优先于「上次设档的结果」。 */
function divergedHint(thread: Thread, engineLabel: string, trustLabel: string): TrustHint | undefined {
  const diverged = thread.engineState?.axes.find((a) => a.match === "diverged")
  if (diverged === undefined) return undefined
  const name = diverged.label ?? diverged.id
  return {
    kind: "diverged",
    // **后半句不能省。** 只说前半句，用户会以为自己的档位被引擎改掉了——
    // 而 omni 的判定层其实一直按他选的那一档在拦
    text: `${engineLabel} 那边现在是 ${name}（不是 omni 切的）。omni 的审批层仍按「${trustLabel}」在拦。`,
    action: { label: "切回来", kind: "reapply" },
  }
}

/** omni 设档没设上，或者这家压根不报——两种都只是说明，**没有动作可做**。 */
function applyHint(thread: Thread, engineLabel: string): TrustHint | undefined {
  const apply = thread.trustApply
  if (apply?.result === "fixed") {
    // 不给动作：能做的是「新开一条会话」，而那是另一个入口的事，
    // 在这里再放一个按钮等于把同一件事摆两处
    return { kind: "fixed", text: apply.detail ?? `${engineLabel} 的档位在开会话时就定死了，换档要重开一条会话。` }
  }
  if (apply?.result === "unmapped") {
    return { kind: "unmapped", text: apply.detail ?? `这一档在 ${engineLabel} 上只在 omni 本机判定层生效。` }
  }
  // **读不回来**和「读得回来、现在恰好对齐」必须分得开，否则界面上长得一模一样。
  // 只在引擎从没报过任何一维时说这句：报过就说明它会报，那就以观测值为准
  if (thread.capabilities?.modeReadback === false && thread.engineState === undefined) {
    return {
      kind: "blind",
      text: `${engineLabel} 不会把它自己改的档位告诉 omni；这里显示的是 omni 让它去的那一档。`,
    }
  }
  return undefined
}

/**
 * @param engineLabel 引擎的显示名。**插值进去，不写字面量**——写死「Claude」的话，
 *   换一家引擎那句话就在撒谎。
 * @param trustLabel omni 当前档位的中文名，用来说「omni 的审批层仍按 X 在拦」。
 */
export function trustHint(thread: Thread, engineLabel: string, trustLabel: string): TrustHint | undefined {
  return divergedHint(thread, engineLabel, trustLabel) ?? applyHint(thread, engineLabel)
}
