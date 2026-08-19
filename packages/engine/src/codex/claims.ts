/**
 * **omni 在握手时认领了 codex 的哪些实验面。**
 *
 * ## 为什么要有这张表
 *
 * app-server 有一部分能力藏在 `initialize` 的 `capabilities` 后面（源码里标着
 * `#[experimental(...)]`）。不认领，引擎就不发——而界面上看到的是**一个格子空着**。
 * 那个空格和「这家引擎确实没有这件事」长得一模一样：**omni 自己的握手把它挡住了，
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
 * - **认了必须用**：`buys` 里的每一条都要真有 handler。认了却不消费，
 *   等于白白把自己绑在一个不稳定的面上。
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
  /** 在哪个版本上核对过。实验面会变，这一栏是下次核对的起点。 */
  checked: string
}

export const CLAIMS: Readonly<Record<string, Claim>> = {
  experimentalApi: {
    why: "换 `thread/settings/updated`——codex 唯一会主动报「我现在是什么档」的通知。不认领它，档位回读那一格就永远空着，而空着看起来就像 codex 不支持。",
    buys: ["thread/settings/updated"],
    checked: "openai/codex @ 3b45c2906（2026-08-19）：ThreadSettingsUpdated 标着 #[experimental(\"thread/settings/updated\")]；另有 A/B 实跑——不认领时 thread/settings/update 直接回 requires experimentalApi capability",
  },
}

/** 握手时真正发出去的那个对象。**只有这一个来源**，代码不许另写一份。 */
export function claimedCapabilities(): Readonly<Record<string, boolean>> {
  return Object.fromEntries(Object.keys(CLAIMS).map((name) => [name, true]))
}
