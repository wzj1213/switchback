import { describe, expect, it } from "vitest"
import type { EngineStatus, Trust } from "@omni/protocol"
import type { ServerCall } from "../rpc.js"
import { pickOption, summarize } from "./approve.js"
import { applyTrust, modeAxis, needsNativeRestart, pickMode } from "./mode.js"
import { handlePermission, type PermissionContext } from "./permission.js"
import type { AcpPermissionOption, AcpToolCall } from "./wire.js"

/** 实测 codex-acp 发来的那张表，一字不改。 */
const REAL_OPTIONS: readonly AcpPermissionOption[] = [
  { optionId: "allow_once", name: "Allow Once", kind: "allow_once" },
  { optionId: "allow_always", name: "Allow for Session", kind: "allow_always" },
  { optionId: "reject_once", name: "Reject", kind: "reject_once" },
]

describe("挑选项", () => {
  it("按 kind 挑，不认 optionId 的字面值——那是 agent 自己定的不透明串", () => {
    const opaque: readonly AcpPermissionOption[] = [
      { optionId: "opt-7", kind: "allow_once" },
      { optionId: "opt-9", kind: "reject_once" },
    ]
    expect(pickOption(opaque, true, "once")).toBe("opt-7")
    expect(pickOption(opaque, false, "once")).toBe("opt-9")
  })

  it("记住了就挑 allow_always", () => {
    expect(pickOption(REAL_OPTIONS, true, "session")).toBe("allow_always")
    expect(pickOption(REAL_OPTIONS, true, "project")).toBe("allow_always")
    expect(pickOption(REAL_OPTIONS, true, "once")).toBe("allow_once")
  })

  it("想拒但只有 reject_once 时用它——同极性内降级是允许的", () => {
    expect(pickOption(REAL_OPTIONS, false, "project")).toBe("reject_once")
  })

  it("**只有 allow 选项时，想拒就一个都不挑**——绝不能把拒绝降级成放行", () => {
    const allowOnly: readonly AcpPermissionOption[] = [{ optionId: "a", kind: "allow_once" }]
    expect(pickOption(allowOnly, false, "once")).toBeUndefined()
  })

  it("反向同理：只有 reject 时不去猜「他其实想过」", () => {
    const rejectOnly: readonly AcpPermissionOption[] = [{ optionId: "r", kind: "reject_once" }]
    expect(pickOption(rejectOnly, true, "once")).toBeUndefined()
  })

  it("kind 缺失时按 optionId 前缀兜底，仍不跨极性", () => {
    const noKind: readonly AcpPermissionOption[] = [{ optionId: "allow-1" }, { optionId: "reject-1" }]
    expect(pickOption(noKind, true, "once")).toBe("allow-1")
    expect(pickOption(noKind, false, "once")).toBe("reject-1")
  })
})

function capture(): { call: ServerCall; got: { result: unknown } } {
  const got = { result: undefined as unknown }
  return {
    got,
    call: {
      id: 1,
      method: "session/request_permission",
      params: {
        toolCall: { toolCallId: "c1", kind: "edit", status: "pending" },
        options: REAL_OPTIONS,
      },
      respond: (result: unknown) => {
        got.result = result
      },
    },
  }
}

function ctxWith(
  trust: Trust,
  inflight: Map<string, AcpToolCall>,
  askUser: PermissionContext["askUser"] = () => Promise.resolve({ allow: false, remember: "once" }),
): PermissionContext {
  return {
    engine: "acp:test",
    cwd: "/w",
    home: "/home/u",
    trust: () => trust,
    memory: () => [],
    inflight,
    askUser,
    // 测试不等：真机上是 300ms，等待本身另有专门的用例
    waitMs: 0,
  }
}

describe("判一条审批", () => {
  it("**在途表补齐了细节，判定才看得见路径**——请求体里只有 id 和 kind", async () => {
    const inflight = new Map<string, AcpToolCall>([
      [
        "c1",
        {
          toolCallId: "c1",
          kind: "edit",
          title: "Editing files",
          content: [{ type: "diff", path: "/etc/passwd", oldText: "旧", newText: "新" }],
        },
      ],
    ])
    const asked: string[] = []
    const { call, got } = capture()
    await handlePermission(
      ctxWith("full", inflight, (ask) => {
        asked.push(ask.summary)
        return Promise.resolve({ allow: false, remember: "once" })
      }),
      call,
    )
    // 写到 /etc 是红线，`full` 档也要问；问的时候说得出改的是哪个文件
    expect(asked).toHaveLength(1)
    expect(got.result).toEqual({ outcome: { outcome: "selected", optionId: "reject_once" } })
  })

  it("在途表里查不到也照样问，不替用户默默放行", async () => {
    const asked: string[] = []
    const { call, got } = capture()
    await handlePermission(
      ctxWith("read-only", new Map(), (ask) => {
        asked.push(ask.summary)
        return Promise.resolve({ allow: true, remember: "once" })
      }),
      call,
    )
    expect(asked[0]).toContain("详情未送达")
    expect(got.result).toEqual({ outcome: { outcome: "selected", optionId: "allow_once" } })
  })

  it("用户选了「本会话不再问」就回 allow_always，让 agent 自己也记住", async () => {
    const inflight = new Map<string, AcpToolCall>([
      ["c1", { toolCallId: "c1", kind: "edit", content: [{ type: "diff", path: "/etc/hosts", newText: "x" }] }],
    ])
    const { call, got } = capture()
    await handlePermission(
      ctxWith("full", inflight, () => Promise.resolve({ allow: true, remember: "session" })),
      call,
    )
    expect(got.result).toEqual({ outcome: { outcome: "selected", optionId: "allow_always" } })
  })

  it("**read-only 档下 omni 自己就拒了，根本不问**——引擎问不问是它的事，判定是我们的事", async () => {
    const inflight = new Map<string, AcpToolCall>([
      ["c1", { toolCallId: "c1", kind: "edit", content: [{ type: "diff", path: "/w/a.ts", newText: "x" }] }],
    ])
    let asked = 0
    const { call, got } = capture()
    await handlePermission(
      ctxWith("read-only", inflight, () => {
        asked += 1
        return Promise.resolve({ allow: true, remember: "once" })
      }),
      call,
    )
    expect(asked).toBe(0)
    expect(got.result).toEqual({ outcome: { outcome: "selected", optionId: "reject_once" } })
  })
})

describe("给人看的那句话", () => {
  it("有 title 就用 title——那是 agent 写好的人话", () => {
    expect(summarize({ toolCallId: "c", kind: "read", title: "Read file '/w/a.ts'" })).toBe("Read file '/w/a.ts'")
  })

  it("**title 是引擎给的文本，必须过 sanitize**——带换行的标题能把审批卡撑成一段假对话", () => {
    const out = summarize({
      toolCallId: "c",
      kind: "execute",
      title: "看起来无害\n\n实际上\u001b[31m还带了 ANSI",
    })
    // 控制字符换成空格再压空白：ESC 没了，它后面的 `[31m` 只是普通字符，不再是转义序列
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/[\u0000-\u001F]/)
    expect(out).toBe("看起来无害 实际上 [31m还带了 ANSI")
  })

  it("没有 title 时按形态说，说不清就明说说不清", () => {
    expect(summarize({ toolCallId: "c", kind: "execute", rawInput: { command: "rm -rf /" } })).toBe("执行 rm -rf /")
    expect(summarize(undefined)).toContain("详情未送达")
  })
})

describe("信任档落到 agent 自己定义的 mode 上", () => {
  /** 实测 codex-acp 报的三档。 */
  const REAL = [
    { id: "read-only", name: "Read-only" },
    { id: "agent", name: "Agent" },
    { id: "agent-full-access", name: "Agent (full access)" },
  ]

  it("三档各归各位", () => {
    expect(pickMode(REAL, "read-only")).toBe("read-only")
    expect(pickMode(REAL, "auto-edit")).toBe("agent")
    expect(pickMode(REAL, "full")).toBe("agent-full-access")
  })

  it("**auto-edit 绝不能选到 full access 那一档**——猜偏的方向必须是安全的那边", () => {
    expect(pickMode(REAL, "auto-edit")).not.toBe("agent-full-access")
  })

  it("认不出的档位表就返回 undefined，由驱动保持引擎默认档并说明", () => {
    expect(pickMode([{ id: "alpha" }, { id: "beta" }], "auto-edit")).toBeUndefined()
    expect(pickMode([], "full")).toBeUndefined()
  })

  it("别家的叫法也认：plan / edit / yolo", () => {
    const other = [{ id: "plan" }, { id: "edit" }, { id: "yolo" }]
    expect(pickMode(other, "read-only")).toBe("plan")
    expect(pickMode(other, "auto-edit")).toBe("edit")
    expect(pickMode(other, "full")).toBe("yolo")
  })

  /** 只记账的会话：发出去的 RPC 和说出去的话都收下来。 */
  function trustCtx(mode: string | undefined, native?: { meta: Readonly<Record<string, unknown>> }) {
    const calls: { method: string; params: unknown }[] = []
    const said: { status: EngineStatus; detail?: string }[] = []
    const applied: { result: string; detail?: string }[] = []
    const ctx = {
      apply: (result: { result: string; detail?: string }) => {
        applied.push(result)
      },
      id: "acp:kimi",
      state: { acpSession: "s-1", mode, native },
      call: (method: string, params: unknown) => {
        calls.push({ method, params })
        return Promise.resolve({})
      },
      status: (status: EngineStatus, detail?: string) => {
        said.push({ status, ...(detail === undefined ? {} : { detail }) })
      },
    }
    return { ctx, calls, said, applied }
  }

  it("**agent 自己切走之后再切回来，必须真的发出去**——不然切档是个空操作", async () => {
    // omni 设过 `agent`，随后 agent 自己切到了别处（`current_mode_update` 落不到
    // 驱动的 state 上，omni 无从得知）。用户在界面上切回 auto-edit ——
    // 上一版在这里比对 `state.mode` 判定「已经是 agent 了」，一发不发：
    // 引擎停在它自己那一档，界面显示切成功了，而且没有任何地方出声
    const h = trustCtx("agent")
    await applyTrust(h.ctx, "auto-edit", REAL)
    expect(h.calls.map((c) => c.method)).toEqual(["session/set_mode"])
    expect((h.calls[0]?.params as { modeId: string }).modeId).toBe("agent")
  })

  it("档位表里认不出对应项时什么都不发，并说明保持了引擎自己的默认档", async () => {
    const h = trustCtx(undefined)
    await applyTrust(h.ctx, "auto-edit", [{ id: "alpha" }, { id: "beta" }])
    expect(h.calls).toEqual([])
    expect(h.applied[0]?.result).toBe("unmapped")
    expect(h.applied[0]?.detail).toContain("已保持引擎自己的默认档")
  })

  /**
   * **这句话以前一个用户都没看见过。** 它走的是 `engine.status` 的 `ready` 档，
   * 而 `store` 的 `LOUD` 只收 crashed/timeout/degraded——代码里写着，界面上没有。
   * 钉住「不再走 status」，免得哪天有人顺手改回去。
   */
  it("设档结果不再走 engine.status——那条路会被 LOUD 静默丢掉", async () => {
    const h = trustCtx(undefined)
    await applyTrust(h.ctx, "auto-edit", [{ id: "alpha" }])
    await applyTrust(h.ctx, "auto-edit", [])
    expect(h.said).toEqual([])
    expect(h.applied.map((a) => a.result)).toEqual(["unmapped", "unmapped"])
  })

  it("真设上了要报 applied——界面据此知道「这一档是真的落下去了」", async () => {
    const h = trustCtx(undefined)
    await applyTrust(h.ctx, "auto-edit", REAL)
    expect(h.applied.map((a) => a.result)).toEqual(["applied"])
  })

  it("没有 mode 表但原生开场扩展位已落下时同样报 applied", async () => {
    const h = trustCtx(undefined, { meta: { yoloMode: false, autoMode: true } })
    await applyTrust(h.ctx, "auto-edit", [])
    expect(h.applied).toEqual([{ result: "applied" }])
  })

  it.each([
    ["同一原生档不用重启", { autoMode: true }, { autoMode: true }, false],
    ["Auto 切 Always-approve 要重启", { autoMode: true }, { yoloMode: true }, true],
    ["没有私有开关的通用 ACP 不重启", undefined, { autoMode: true }, false],
  ] as const)("%s", (_name, current, target, expected) => {
    const wrap = (
      meta: Readonly<Record<string, unknown>> | undefined,
    ): { meta: Readonly<Record<string, unknown>> } | undefined =>
      meta === undefined ? undefined : { meta }
    expect(needsNativeRestart(wrap(current), wrap(target))).toBe(expected)
  })
})

/**
 * ACP 的审批请求**不带命令原文**。实测 kimi 的顺序是
 * `tool_call`（有 kind、没命令）→ `request_permission`（没 kind、没命令）
 * → **批准之后** `tool_call_update {rawInput:{command}}`，而最后那条只晚 2ms。
 *
 * 不等就判的代价：靠命令原文的 8 条红线一条都匹配不上，然后按档位静默放行。
 */
describe("等在途表把命令补齐", () => {
  const ask = (): { call: ServerCall; got: { result?: unknown } } => {
    const got: { result?: unknown } = {}
    return {
      got,
      // kimi 的审批请求就是这个形状：只有 id 和 title，没有 kind、没有命令
      call: {
        id: 1,
        method: "session/request_permission",
        params: { toolCall: { toolCallId: "c9", title: "Bash" }, options: REAL_OPTIONS },
        respond: (result: unknown) => {
          got.result = result
        },
      },
    }
  }

  it("详情晚到也等得到，红线跟着活过来", async () => {
    const inflight = new Map<string, AcpToolCall>([["c9", { toolCallId: "c9", kind: "execute", title: "Bash" }]])
    const { call, got } = ask()
    // 审批请求已经在处理中，命令随后才到——就像真机上那 2ms
    const done = handlePermission({ ...ctxWith("auto-edit", inflight), waitMs: 500 }, call)
    setTimeout(() => {
      inflight.set("c9", { toolCallId: "c9", kind: "execute", rawInput: { command: "cat .env" } })
    }, 30)
    await done
    // `cat .env` 是凭据红线：等到了命令才拒得掉，不等就是静默放行
    expect(got.result).toEqual({ outcome: { outcome: "selected", optionId: "reject_once" } })
  })

  it("等不到就按「看不见」判：自动编辑档问一次，而不是放行", async () => {
    const inflight = new Map<string, AcpToolCall>([["c9", { toolCallId: "c9", kind: "execute", title: "Bash" }]])
    const asked: string[] = []
    const { call } = ask()
    await handlePermission(
      {
        ...ctxWith("auto-edit", inflight, (a) => {
          asked.push(a.summary)
          return Promise.resolve({ allow: false, remember: "once" })
        }),
        waitMs: 20,
      },
      call,
    )
    expect(asked).toHaveLength(1)
  })

  it("只读档下等不到也不打扰用户——直接拒", async () => {
    const inflight = new Map<string, AcpToolCall>([["c9", { toolCallId: "c9", kind: "execute", title: "Bash" }]])
    const asked: string[] = []
    const { call, got } = ask()
    await handlePermission(
      {
        ...ctxWith("read-only", inflight, (a) => {
          asked.push(a.summary)
          return Promise.resolve({ allow: true, remember: "once" })
        }),
        waitMs: 20,
      },
      call,
    )
    expect(asked).toEqual([])
    expect(got.result).toEqual({ outcome: { outcome: "selected", optionId: "reject_once" } })
  })

  // 审批请求是**引用**不是补丁：照补丁语义合并会把在途表里已知的 kind 清掉
  it("请求体里没有的字段不许覆盖在途表里已知的", async () => {
    const inflight = new Map<string, AcpToolCall>([
      ["c9", { toolCallId: "c9", kind: "execute", rawInput: { command: "ls -la" } }],
    ])
    const asked: string[] = []
    const { call, got } = ask()
    await handlePermission(
      {
        ...ctxWith("auto-edit", inflight, (a) => {
          asked.push(a.summary)
          return Promise.resolve({ allow: false, remember: "once" })
        }),
        waitMs: 0,
      },
      call,
    )
    // kind 保住了 → exec + 命令看得见 → 自动编辑档直接放行，不打扰
    expect(asked).toEqual([])
    expect(got.result).toEqual({ outcome: { outcome: "selected", optionId: "allow_once" } })
  })
})

/**
 * 引擎报的当前档 → 一条轴。`match` 三态里 **`unknown` 是这次补的**：
 * 二元装不下「omni 压根没设过」，而实测 grok 正是那种——不报档位表、却推当前档。
 */
describe("引擎报的当前档怎么变成一条轴", () => {
  const REAL = [
    { id: "read-only", name: "Read-only" },
    { id: "agent", name: "Agent" },
  ]

  it("引擎报的正是 omni 想要的那一档 → aligned", () => {
    expect(modeAxis(REAL, "auto-edit", "agent").match).toBe("aligned")
  })

  it("引擎跑到别的档上去了 → diverged", () => {
    expect(modeAxis(REAL, "auto-edit", "read-only").match).toBe("diverged")
  })

  it("**omni 匹配不出任何目标时是 unknown，不是 diverged**——没设过就谈不上分家", () => {
    expect(modeAxis([], "auto-edit", "default").match).toBe("unknown")
    expect(modeAxis([{ id: "alpha" }], "auto-edit", "alpha").match).toBe("unknown")
  })

  it("人话名原样带出来；引擎没给就不给——界面不自己编一个中文名", () => {
    expect(modeAxis(REAL, "auto-edit", "agent").label).toBe("Agent")
    expect(modeAxis([{ id: "x" }], "auto-edit", "x").label).toBeUndefined()
  })
})
