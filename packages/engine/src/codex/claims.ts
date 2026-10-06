/**
 * **Switchback 在握手时认领了 codex 的哪些实验面。**
 *
 * ## 为什么要有这张表
 *
 * app-server 有一部分能力藏在 `initialize` 的 `capabilities` 后面（源码里标着
 * `#[experimental(...)]`）。不认领，引擎就不发——而界面上看到的是**一个格子空着**。
 * 那个空格和「这家引擎确实没有这件事」长得一模一样：**Switchback 自己的握手把它挡住了，
 * 却让它伪装成引擎的属性。**
 *
 * 所以认领这件事必须留痕：认了什么、为什么认、认了之后换来哪几条通知。
 * 那正是这张表。
 *
 * ## 为什么配一条 CI 断言
 *
 * 认领实验面是有代价的——**厂商标了 experimental 就意味着它会变**。
 * 所以两个方向都要卡死：
 *
 * - **认了必须用**：`buys` 里的通知要有 handler，反向 RPC 要有应答，客户端方法/字段
 *   要在回归和版本戳里点名。认了却不消费，等于白白把自己绑在一个不稳定的面上。
 * - **握手发的必须和这张表一致**：代码里那一发 `initialize` 不能和表漂开，
 *   否则表就成了一份「看起来记着、其实没人对照」的文档。
 *
 * 两条都在 `claims.test.ts` 里。
 */
export interface Claim {
  /** 为什么认领它。**说不出换来什么就不该认**。 */
  why: string
  /** 认领之后引擎才会发的那些通知。CI 断言它们每一条都真有 handler。 */
  buys: readonly string[]
  /** 认领之后才会发的反向 RPC；每一条都必须有精确应答。 */
  requests?: readonly string[]
  /** 认领后才可调用的方法或携带的字段；对应调用点必须有协议回归和版本戳。 */
  methods?: readonly string[]
  /** 在哪个版本上核对过。实验面会变，这一栏是下次核对的起点。 */
  checked: string
}

export const CLAIMS: Readonly<Record<string, Claim>> = {
  experimentalApi: {
    why: "换 `thread/settings/updated` 的原生档位回读、`item/tool/requestUserInput` 的结构化问题与严格安全复核提示。它们都有现成产品落点；不认领才会把引擎能力伪装成空白。",
    buys: ["thread/settings/updated", "autoApprovalReview/strictReviewRequired"],
    requests: ["item/tool/requestUserInput"],
    checked: "openai/codex rust-v0.149.0（2026-08-25）：本机 generate-ts 与官方 app-server 文档核对；requestUserInput、档位通知与严格复核均有定向回归。分叉只使用稳定的 thread/read(includeTurns) 与 thread/fork.lastTurnId，不再认领 schema 中不存在的实验字段。",
  },
}

/** 握手时真正发出去的那个对象。**只有这一个来源**，代码不许另写一份。 */
export function claimedCapabilities(): Readonly<Record<string, boolean>> {
  return {
    ...Object.fromEntries(Object.keys(CLAIMS).map((name) => [name, true])),
    // 0.149.0 的 InitializeCapabilities 已把它列为必填；Switchback 不代管上游凭据证明。
    requestAttestation: false,
  }
}
