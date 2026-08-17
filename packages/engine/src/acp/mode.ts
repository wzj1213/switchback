import type { EngineStatus, Trust } from "@omni/protocol"
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
 * 并报一条 `engine.status` 说明——见 `driver.ts`。让人知道「omni 的档位
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
    // 这家有自己的审批开关时，说它那句更准（见 `nativeApproval` 的 `note`）
    ctx.status("ready", ctx.state.native?.note ?? `${ctx.id} 没有报告可选档位，omni 的信任档只在本机判定层生效。`)
    return
  }
  const target = pickMode(modes, trust)
  if (target === undefined) {
    const names = modes.map((m) => m.id ?? "?").join("、")
    ctx.status("ready", `omni 的「${trust}」档在 ${ctx.id} 的档位（${names}）里找不到对应项，已保持引擎自己的默认档。`)
    return
  }
  if (target === ctx.state.mode) return
  await ctx.call("session/set_mode", { sessionId: ctx.state.acpSession, modeId: target })
  ctx.state.mode = target
}

/**
 * 原生审批开关**开会话时就定死了**（grok 的 `yoloMode` 在 `session/new` 里）。
 *
 * 改不了就说出来，和 codex 的沙箱同一条原则：一个「界面上换了、引擎那边没换」
 * 的档位比不给换糟得多——尤其是往严的方向换，用户会以为自己已经收紧了。
 */
export function warnNativeFixed(ctx: TrustCtx, trust: Trust): void {
  const want = ctx.nativeApproval?.(trust)
  if (want === undefined || ctx.state.native === undefined) return
  if (JSON.stringify(want.meta ?? {}) === JSON.stringify(ctx.state.native.meta ?? {})) return
  ctx.status(
    "degraded",
    `${ctx.id} 的原生审批开关在开会话时就定死了，换档要重开一条会话才生效。这条会话仍然按开场时那一档在跑。`,
  )
}
