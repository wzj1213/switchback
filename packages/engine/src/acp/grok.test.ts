import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  grokChatPath,
  grokContextUsed,
  grokLogPath,
  grokModelChanged,
  grokNativeApproval,
  grokNotice,
  grokNotification,
  grokWorkspaceDir,
} from "./grok.js"

/**
 * 目录名的编码规则是从真机上已有的目录反解出来的，所以这张表里的
 * 期望值都是**照抄磁盘**，不是照着 `encodeURIComponent` 的文档写的。
 */
describe("grok 工作区目录名", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["/Users/you/work/diagen", "%2FUsers%2Fyou%2Fwork%2Fdiagen"],
    // `-` 保持原样：这一条排除了「所有非字母数字都编码」那种规则
    ["/var/folders/8c/T/grok-probe-QCPiIH", "%2Fvar%2Ffolders%2F8c%2FT%2Fgrok-probe-QCPiIH"],
    ["/Users/you/work/omni", "%2FUsers%2Fyou%2Fwork%2Fomni"],
  ]

  for (const [cwd, dir] of cases) {
    it(`${cwd} → ${dir}`, () => {
      expect(grokWorkspaceDir(cwd)).toBe(dir)
    })
  }

  it("拼出来的是那份「和模型之间的全部往来」，不是概要", () => {
    expect(grokChatPath("/home/u", "/w", "sid")).toBe("/home/u/.grok/sessions/%2Fw/sid/chat_history.jsonl")
  })
})

/** 摆一个假的 `~/.grok/sessions`，`dir` 是工作区那一层的目录名。 */
function plant(dir: string, sessionId: string): string {
  const home = mkdtempSync(join(tmpdir(), "omni-grok-"))
  const session = join(home, ".grok", "sessions", dir, sessionId)
  mkdirSync(session, { recursive: true })
  writeFileSync(join(session, "chat_history.jsonl"), "{}\n")
  return home
}

describe("grok 记录定位", () => {
  const CWD = "/Users/you/work/omni"
  const ID = "01a00e5e-2fea-7233-b9d1-617f71ac0a38"

  it("算得中就直接给", async () => {
    const home = plant(grokWorkspaceDir(CWD), ID)
    expect(await grokLogPath(home, ID, CWD)).toBe(grokChatPath(home, CWD, ID))
  })

  /**
   * 这条才是要紧的：我们是用 `encodeURIComponent` 去对 grok 那边 Rust 写的编码器，
   * 换一条带中文或空格的路径就可能对不上。**对不上必须还能找到**，
   * 否则时间线会悄悄少掉全量原文入口，用户不会知道自己本来可以取到。
   */
  it("编码规则对不上时按 sessionId 扫出来", async () => {
    const home = plant("这个目录名和我们算的不一样", ID)
    expect(await grokLogPath(home, ID, CWD)).toBe(
      join(home, ".grok", "sessions", "这个目录名和我们算的不一样", ID, "chat_history.jsonl"),
    )
  })

  it("真没有就给 undefined，不是编一个路径出来", async () => {
    const home = plant(grokWorkspaceDir(CWD), "别的会话")
    expect(await grokLogPath(home, ID, CWD)).toBeUndefined()
  })

  it("连 sessions 目录都没有也不抛", async () => {
    expect(await grokLogPath(mkdtempSync(join(tmpdir(), "omni-grok-空-")), ID, CWD)).toBeUndefined()
  })
})

/**
 * grok 一条 ACP `usage_update` 都不发（实测跑完整一轮：kimi 一条，grok 零条），
 * token 数在它自己的私有通知里。不认这条的话它的上下文用量表永远是空的。
 */
describe("grok 的上下文用量", () => {
  const note = (update: unknown): unknown => ({ sessionId: "s", update })

  it("从 turn_completed 里取 totalTokens", () => {
    expect(
      grokContextUsed("_x.ai/session_notification", note({ sessionUpdate: "turn_completed", usage: { totalTokens: 15638 } })),
    ).toBe(15638)
  })

  // 一轮里可能有好几次模型调用，拿它画比例条会在一轮内反复跳
  it("response_completed 不算——那是单次模型调用", () => {
    expect(
      grokContextUsed("_x.ai/session_notification", note({ sessionUpdate: "response_completed", usage: { totalTokens: 99 } })),
    ).toBeUndefined()
  })

  it("别家的通知一律不认", () => {
    expect(grokContextUsed("_x.ai/models/update", note({ sessionUpdate: "turn_completed", usage: { totalTokens: 1 } }))).toBeUndefined()
    expect(grokContextUsed("session/update", note({ sessionUpdate: "turn_completed", usage: { totalTokens: 1 } }))).toBeUndefined()
  })

  // 缺字段、0、类型不对都当没有：宁可不画，也不要画一个 0
  it("拿不到数就给 undefined", () => {
    expect(grokContextUsed("_x.ai/session_notification", note({ sessionUpdate: "turn_completed" }))).toBeUndefined()
    expect(grokContextUsed("_x.ai/session_notification", note({ sessionUpdate: "turn_completed", usage: { totalTokens: 0 } }))).toBeUndefined()
    expect(grokContextUsed("_x.ai/session_notification", note({ sessionUpdate: "turn_completed", usage: { totalTokens: "多" } }))).toBeUndefined()
    expect(grokContextUsed("_x.ai/session_notification", undefined)).toBeUndefined()
  })
})

describe("grok 的图片处理提示", () => {
  const note = (update: unknown): unknown => ({ sessionId: "s", update })

  it("图片真被丢弃时保留每条原生原因", () => {
    expect(
      grokNotice(
        "_x.ai/session_notification",
        note({ sessionUpdate: "image_dropped", notes: ["Image 1 was dropped: corrupt.", "Image 2 was too small."] }),
      ),
    ).toEqual({
      message: "Image 1 was dropped: corrupt.\nImage 2 was too small.",
      level: "warning",
    })
  })

  it("成功压缩保持安静；只有空 images 的重编码降级才显示原生提示", () => {
    expect(
      grokNotice(
        "_x.ai/session_notification",
        note({ sessionUpdate: "image_compressed", images: [{ index: 0 }], message: "compressed" }),
      ),
    ).toBeUndefined()
    expect(
      grokNotice(
        "_x.ai/session_notification",
        note({ sessionUpdate: "image_compressed", images: [], message: "Original image kept." }),
      ),
    ).toEqual({ message: "Original image kept.", level: "warning" })
  })

  it("别的方法、空原因与畸形降级不编提示", () => {
    expect(grokNotice("session/update", note({ sessionUpdate: "image_dropped", notes: ["x"] }))).toBeUndefined()
    expect(grokNotice("_x.ai/session_notification", note({ sessionUpdate: "image_dropped", notes: [] }))).toBeUndefined()
    expect(grokNotice("_x.ai/session_notification", note({ sessionUpdate: "image_compressed", message: "x" }))).toBeUndefined()
  })
})

describe("grok 的自动压缩生命周期", () => {
  const notice = (update: unknown) => grokNotice("_x.ai/session_notification", { sessionId: "s", update })

  it("开始与完成按原生数值显示，旧版缺少 before 也不编", () => {
    expect(notice({ sessionUpdate: "auto_compact_started", percentage: 82 })).toEqual({
      message: "Context 82% full. Compacting…",
      level: "info",
    })
    expect(
      notice({ sessionUpdate: "auto_compact_completed", tokens_before: 120000, tokens_after: 18000, elapsed_ms: 2450 }),
    ).toEqual({ message: "Context compacted: 120000 → 18000 tokens (2.5s)", level: "info" })
    expect(notice({ sessionUpdate: "auto_compact_completed", tokens_after: 9000 })).toEqual({
      message: "Context compacted: → 9000 tokens",
      level: "info",
    })
  })

  it("失败保留原生错误，取消保留原生原因", () => {
    expect(notice({ sessionUpdate: "auto_compact_failed", error: "summary model unavailable" })).toEqual({
      message: "Compaction failed: summary model unavailable",
      level: "warning",
    })
    expect(notice({ sessionUpdate: "auto_compact_cancelled", reason: "user pressed Ctrl+C" })).toEqual({
      message: "Compaction cancelled: user pressed Ctrl+C",
      level: "notice",
    })
  })

  it("关键数值缺席时不拿 0 冒充一次开始或完成", () => {
    expect(notice({ sessionUpdate: "auto_compact_started" })).toBeUndefined()
    expect(notice({ sessionUpdate: "auto_compact_completed", tokens_before: 10 })).toBeUndefined()
    expect(notice({ sessionUpdate: "auto_compact_failed" })).toBeUndefined()
  })
})

describe("grok 的 Hook 注解", () => {
  it("保留首方放在工具调用旁的原文，不从符号猜严重级别", () => {
    const params = { update: { sessionUpdate: "hook_annotation", message: "⚠ `shell` blocked by hook `guard`: denied" } }
    expect(grokNotice("_x.ai/session_notification", params)).toEqual({
      message: "⚠ `shell` blocked by hook `guard`: denied", level: "notice",
    })
    expect(grokNotice("_x.ai/session_notification", {
      update: { sessionUpdate: "hook_annotation", message: "  " },
    })).toBeUndefined()
  })
})

/** 三档都显式占住两枚布尔位，Auto 与 Always-approve 不能再塌成同一档。 */
describe("grok 的原生审批开关", () => {
  it.each([
    ["只读", "read-only", { yoloMode: false, autoMode: false }],
    ["自动审批", "auto-edit", { yoloMode: false, autoMode: true }],
    ["完全访问", "full", { yoloMode: true, autoMode: false }],
  ] as const)("%s 对齐 Grok 原生档", (_name, trust, expected) => {
    expect(grokNativeApproval(trust)).toEqual({ meta: expected })
  })
})

/**
 * **实测原文**：omni 发完 `session/set_model` 之后 grok 回的那一条，
 * 以及你在它自己的界面里改档时它推的那一条，是同一个形状。
 */
describe("grok 报「模型 / 强度换了」", () => {
  const REAL = {
    sessionId: "01a01b0f",
    update: { sessionUpdate: "model_changed", model_id: "grok-4.6", reasoning_effort: "xhigh" },
  }

  it("认出实测的那一条", () => {
    expect(grokModelChanged("_x.ai/session_notification", REAL)).toEqual({
      model: "grok-4.6",
      effort: "xhigh",
    })
  })

  it("**别的方法名一律不认**——驱动这一层不该认识任何一家的私有方法名，认错了会乱改状态", () => {
    expect(grokModelChanged("session/update", REAL)).toBeUndefined()
    expect(grokModelChanged("_x.ai/mcp_initialized", REAL)).toBeUndefined()
  })

  it("同一条通道上的别种更新不认", () => {
    const other = { update: { sessionUpdate: "turn_completed", usage: { totalTokens: 1 } } }
    expect(grokModelChanged("_x.ai/session_notification", other)).toBeUndefined()
  })

  it("只报了一样就只带一样——**没认出来的不编一个**", () => {
    const onlyEffort = { update: { sessionUpdate: "model_changed", reasoning_effort: "low" } }
    expect(grokModelChanged("_x.ai/session_notification", onlyEffort)).toEqual({ effort: "low" })
  })

  it("两样都认不出就当这条与模型无关，**不报一个空的变更**", () => {
    const empty = { update: { sessionUpdate: "model_changed", model_id: 42 } }
    expect(grokModelChanged("_x.ai/session_notification", empty)).toBeUndefined()
    expect(grokModelChanged("_x.ai/session_notification", undefined)).toBeUndefined()
  })

  it("原生自动替换模型时同步新模型；没有替代项时不拿空串清状态", () => {
    const replacement = {
      update: { sessionUpdate: "model_auto_switched", new_model_id: "grok-4.6", reason: "gone" },
    }
    expect(grokModelChanged("_x.ai/session_notification", replacement)).toEqual({ model: "grok-4.6" })
    expect(grokModelChanged("_x.ai/session_notification", {
      update: { sessionUpdate: "model_auto_switched", new_model_id: "", reason: "gone" },
    })).toBeUndefined()
  })
})

describe("grok 模型失效通知", () => {
  const notification = (newModel: string) => grokNotification("_x.ai/session_notification", {
    sessionId: "s",
    update: {
      sessionUpdate: "model_auto_switched",
      previous_model_id: "grok-old",
      new_model_id: newModel,
      reason: "Model \"grok-old\" is no longer available.",
    },
  })

  it("有替代模型时沿用首方文案并显示切换结果", () => {
    expect(notification("grok-4.6")).toEqual({
      key: "model-unavailable",
      message: "Model \"grok-old\" is no longer available. Switched to \"grok-4.6\".",
      priority: "high",
    })
  })

  it("没有替代模型时保留阻塞原因并提高优先级", () => {
    expect(notification("")).toEqual({
      key: "model-unavailable",
      message: "Model \"grok-old\" is no longer available.",
      priority: "immediate",
      color: "error",
    })
  })

  it("别的事件、通道或缺文案时不编通知", () => {
    expect(grokNotification("session/update", {})).toBeUndefined()
    expect(grokNotification("_x.ai/session_notification", {
      update: { sessionUpdate: "model_changed", reason: "x" },
    })).toBeUndefined()
    expect(grokNotification("_x.ai/session_notification", {
      update: { sessionUpdate: "model_auto_switched", reason: "" },
    })).toBeUndefined()
  })
})
