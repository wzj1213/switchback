import type { EngineStatus, Trust, TrustApply } from "@switchback/protocol"
import type { EngineAxis } from "@switchback/protocol"
import type { AcpMode } from "./wire.js"

/**
 * 信任档 → ACP 的 mode。
 *
 * ## 为什么这里只能靠猜
 *
 * codex 的 `sandbox` 是三个固定枚举值，写死一张表就完了。ACP 不是：
 * `availableModes` 是 **agent 自己定义的一串字符串**，协议不规定叫什么、
 * 有几个、什么语义。实测 codex-acp 报的是：
 *
 * ```
 * read-only / agent / agent-full-access   （currentModeId: agent）
 * ```
 *
 * 换一家 ACP agent 完全可能是 `plan / edit / yolo`，或者一个都没有。
 * 所以这里做的是**打分匹配**，不是查表。
 *
 * ## 猜错的方向必须是安全的那一边
 *
 * 关键约束：分数相同或都不匹配时，**取列表里最靠前的那个**——
 * ACP 的惯例（也是 codex-acp 的实际排法）是从严到宽排列。
 * 猜偏一档只是多问几次；猜到 full access 那一档，就是把一个
 * 「能改工作区外的文件、能联网」的模式悄悄打开了。
 *
 * 匹配不上时驱动**不发** `session/set_mode`，保持 agent 自己的默认档，
 * 并经 `TrustCtx.apply` 报一条 `unmapped` 说明。让人知道「Switchback 的档位
 * 在这家引擎上没接上」，比让他以为接上了强得多。
 */

/** 各档的关键词与权重。命中就加分，负分是「明确不像这一档」。 */
const HINTS: Readonly<Record<Trust, readonly (readonly [string, number])[]>> = {
  "read-only": [
    ["read-only", 10],
    ["readonly", 10],
    ["read only", 10],
    ["plan", 6],
    ["ask", 4],
    ["chat", 3],
    ["full", -10],
    ["auto", -6],
  ],
  "auto-edit": [
    /*
     * ⚠️ **`auto` 不能压过 `edit` —— 试过，是错的。**
     *
     * 2026-08-28 曾把它提到 8 分，理由看着很硬：Switchback 给这一档写的定义是
     *「优先使用引擎原生安全评审；需要人工决定时才询问」，而 ZCode
     *（`zcode-acp-server 0.5.1`）的档位表里明明白白有一个 `auto`：
     * `plan / build / edit / yolo / auto`。名字对得严丝合缝。
     *
     * **真机上它是个占位档。** 切过去之后每一条命令都被引擎自己顶回来：
     *
     *     Auto mode is reserved but not implemented yet
     *
     * 连 `pwd`、`echo` 都跑不了——比多问几次坏得多。
     *
     * 教训写在这儿免得下次有人照着同一条推理再改一遍：
     * **`availableModes` 是一张「有哪些名字」的表，不是「哪些能用」的表。**
     * 名字对得上不等于它实现了，而这里除了名字什么都看不见。本文件开头那条
     *「猜错的方向必须是安全的那一边」因此还要再加一句——**没把握就别动**：
     * 停在 `edit`（能改文件、命令要问）最多是多问几次，
     * 停在一个没实现的档是整条会话瘫掉。
     *
     * 那次真正解决「每条 bash 都要放行」的是另一半——`@switchback/approval` 的
     * `classify.ts` 认出了括号里的工具名（`tool permission (Bash)`），
     * 于是自动审批档下 `exec` 本来就该 `allow`。这一半没有引擎侧的赌注。
     */
    ["agent", 6],
    ["edit", 6],
    ["write", 5],
    ["auto", 4],
    ["default", 3],
    ["full", -8],
    ["read-only", -10],
    ["readonly", -10],
    ["danger", -10],
    ["bypass", -10],
    ["yolo", -10],
  ],
  full: [
    ["full", 10],
    ["full-access", 12],
    ["danger", 8],
    ["bypass", 8],
    ["yolo", 8],
    ["all", 4],
    ["read-only", -12],
    ["readonly", -12],
    ["plan", -8],
  ],
}

function score(mode: AcpMode, trust: Trust): number {
  const hay = `${mode.id ?? ""} ${mode.name ?? ""}`.toLowerCase()
  return HINTS[trust].reduce((sum, [word, weight]) => (hay.includes(word) ? sum + weight : sum), 0)
}

/** 命中的最低分。低于它就当没匹配上——半个词的巧合不该拿来定安全档位。 */
const THRESHOLD = 4

export function pickMode(modes: readonly AcpMode[], trust: Trust): string | undefined {
  let best: { id: string; score: number } | undefined
  for (const mode of modes) {
    const id = mode.id
    if (id === undefined || id === "") continue
    const value = score(mode, trust)
    // 严格大于：并列时保留**先出现**的那个，也就是更严的那个
    if (value >= THRESHOLD && (best === undefined || value > best.score)) best = { id, score: value }
  }
  return best?.id
}

/**
 * 把信任档落到引擎上，**并且在落不上时说清楚**。
 *
 * 从驱动里搬进来是行数闸门逼的，但边界本来就在这儿：上面那张打分表定的是
 * 「哪个 mode 对应哪一档」，而「发不发 `session/set_mode`、发不出去怎么向用户交代」
 * 是同一件事的后半段。原来后半段在 `driver.ts`，于是这个文件的注释只能写
 * 「见 driver.ts」——那正是边界划错了的信号。
 */
export interface TrustCtx {
  /** 引擎 id，落进给用户的那句话里。 */
  id: string
  call: (method: string, params: unknown) => Promise<unknown>
  status: (status: EngineStatus, detail?: string) => void
  /**
   * 设档的结果往哪儿报。**时间戳由驱动盖**——这一层不读时钟。
   *
   * 以前这三种结果全走 `ctx.status("ready", …)`，而 `store` 的 `LOUD` 只收
   * crashed/timeout/degraded：**代码里写着，用户一次都没看见过**。
   */
  apply?: (result: Omit<TrustApply, "at">) => void
  state: {
    acpSession: string | undefined
    mode: string | undefined
    /** 这家自己的审批开关（见 `AcpDriverConfig.nativeApproval`）。 */
    native: { meta?: Readonly<Record<string, unknown>>; note?: string } | undefined
  }
  nativeApproval?: (trust: Trust) => { meta?: Readonly<Record<string, unknown>>; note?: string }
}

/**
 * 匹配不上就**什么都不发**，保持 agent 自己的默认档，并明说一句。
 * 硬塞一个猜的 mode 比不塞危险得多：塞错方向就是悄悄放开了权限。
 */
export async function applyTrust(ctx: TrustCtx, trust: Trust, modes: readonly AcpMode[]): Promise<void> {
  if (ctx.state.acpSession === undefined) return
  if (modes.length === 0) {
    // Grok 这类 agent 不走 ACP mode 表，而在 session/new 的私有扩展位接原生档。
    // 开会话那一发已经成功才会走到这里，所以不能反过来报「没设上」。
    if (ctx.state.native?.meta !== undefined) {
      ctx.apply?.({ result: "applied" })
      return
    }
    ctx.apply?.({
      result: "unmapped",
      detail: ctx.state.native?.note ?? `${ctx.id} 没有报告可选档位，Switchback 的信任档只在本机判定层生效。`,
    })
    return
  }
  const target = pickMode(modes, trust)
  if (target === undefined) {
    const names = modes.map((m) => m.id ?? "?").join("、")
    ctx.apply?.({
      result: "unmapped",
      detail: `Switchback 的「${trust}」档在 ${ctx.id} 的档位（${names}）里找不到对应项，已保持引擎自己的默认档。`,
    })
    return
  }
  // **不因为「看起来已经是这一档」而跳过。**
  //
  // 上一版这里有一句 `if (target === ctx.state.mode) return`，省一次 RPC。
  // 它成立的前提是 `state.mode` 一直等于引擎真正在用的档——而这个前提是假的：
  // ACP 的 mode 是**双向**的，agent 能自己切（`current_mode_update`，见 `update.ts`
  // 的 `onModeChanged`），而那条通知落不到这里——`UpdateContext` 里根本没有驱动的
  // state，它只发了一条 `engine.status`，还是 `ready` 那一档，被 `store` 的 `LOUD`
  // 过滤掉了。
  //
  // 于是：agent 自己从 X 切到 Y 之后，用户在界面上再切回 X，这里比对的是
  // `state.mode`（还记着 X）→ 判定「已经是了」→ **一发不发**。引擎停在 Y，
  // 界面显示 X，而且没有任何地方出声。**切档变成了空操作。**
  //
  // 多发一次 `session/set_mode` 只是一次幂等 RPC；上面那个谎要靠用户自己撞见。
  await ctx.call("session/set_mode", { sessionId: ctx.state.acpSession, modeId: target })
  ctx.state.mode = target
  ctx.apply?.({ result: "applied" })
}

interface NativeApproval {
  meta?: Readonly<Record<string, unknown>>
}

/** 私有开场扩展位不同就必须续接重启，不能先把界面改成一个尚未生效的档位。 */
export function needsNativeRestart(
  current: NativeApproval | undefined,
  target: NativeApproval | undefined,
): boolean {
  if (current === undefined || target === undefined) return false
  return JSON.stringify(current.meta ?? {}) !== JSON.stringify(target.meta ?? {})
}

/**
 * 引擎报了一个当前档位 → 一条 `EngineAxis`。
 *
 * **`match` 在这里判，不在界面判**：界面手上只有一个 modeId，而「Switchback 的哪一档
 * 对应它」是一对多的反向问题；这里有档位表和当前信任档，重算一次 `pickMode`
 * 就知道 Switchback 想要的是哪个，比一比即可。
 *
 * `pickMode` 返回 undefined 时算 **`unknown` 而不是 `diverged`**：那种情况下
 * Switchback 压根没发过 `session/set_mode`（见 `applyTrust`），**没有可比的基准**。
 * 报 `diverged` 会在实测的 grok 上常亮一条假警告——它不报档位表、却推当前档。
 * 「为什么没有基准」由 `trustApply` 的 `unmapped` 那条去讲，不塞进这一个字段。
 */
export function modeAxis(modes: readonly AcpMode[], trust: Trust, modeId: string): EngineAxis {
  const label = modes.find((m) => m.id === modeId)?.name
  const want = pickMode(modes, trust)
  return {
    axis: "mode",
    id: modeId,
    ...(label === undefined || label === "" ? {} : { label }),
    match: want === undefined ? "unknown" : want === modeId ? "aligned" : "diverged",
  }
}
