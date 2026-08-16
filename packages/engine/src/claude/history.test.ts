import { describe, expect, it } from "vitest"
import { parseAccount, scanHead, toItems } from "./history.js"

/**
 * Claude 存盘会话的解析。这里的样本形状全部来自**真实文件**
 *（`~/.claude/projects/<项目>/<sessionId>.jsonl`），不是编的——
 * rateLimits 的 `resetsAt` 那次就是编样本编出来的坑。
 */

const line = (o: unknown): string => JSON.stringify(o)

describe("文件头：标题和工作区", () => {
  it("人自己起的名字最优先", () => {
    const text = [
      line({ type: "custom-title", customTitle: "我起的名字" }),
      line({ type: "ai-title", aiTitle: "自动总结的" }),
      line({ type: "user", cwd: "/w", message: { role: "user", content: "第一句" } }),
    ].join("\n")
    expect(scanHead(text).title).toBe("我起的名字")
  })

  it("没有自己起的，用自动总结的", () => {
    const text = [line({ type: "ai-title", aiTitle: "自动总结的" }), line({ cwd: "/w" })].join("\n")
    expect(scanHead(text).title).toBe("自动总结的")
  })

  it("**两样都没有就退回第一句话**——比「（没有标题）」有用得多", () => {
    const text = [line({ type: "user", cwd: "/w", message: { role: "user", content: "帮我看看这个报错" } })].join("\n")
    expect(scanHead(text).first).toBe("帮我看看这个报错")
  })

  it("续跑注入的那段摘要不算「第一句话」——拿它当标题每条都长一样", () => {
    const content = "This session is being continued from a previous conversation…"
    const text = line({ type: "user", cwd: "/w", message: { role: "user", content } })
    expect(scanHead(text).first).toBeUndefined()
  })

  it("子 agent 的话不算第一句", () => {
    const text = line({ type: "user", isSidechain: true, cwd: "/w", message: { role: "user", content: "子任务" } })
    expect(scanHead(text).first).toBeUndefined()
  })

  it("**最后一行断了也不能崩**：我们只读固定字节数，断行是常态不是异常", () => {
    const cut = '{"type":"user","cwd":"/w","mess'
    const text = [line({ type: "custom-title", customTitle: "好名字" }), cut].join("\n")
    expect(scanHead(text).title).toBe("好名字")
  })
})

describe("正文：存盘记录 → transcript", () => {
  const user = (text: string, extra = {}): Record<string, unknown> => ({
    type: "user",
    timestamp: "2026-08-16T00:00:00.000Z",
    message: { role: "user", content: text },
    ...extra,
  })
  const assistant = (content: unknown[]): Record<string, unknown> => ({
    type: "assistant",
    timestamp: "2026-08-16T00:00:01.000Z",
    message: { role: "assistant", content },
  })

  it("一句人话 + 一句回答", () => {
    const items = toItems([user("跑一下测试"), assistant([{ type: "text", text: "好的" }])], 0)
    expect(items.map((i) => i.kind)).toEqual(["user_message", "agent_message"])
  })

  it("**每句人话开一轮**——不然整段历史挤成一轮，界面上一条分界线都没有", () => {
    const items = toItems([user("第一句"), assistant([{ type: "text", text: "a" }]), user("第二句")], 0)
    expect(new Set(items.map((i) => i.turnId)).size).toBe(2)
  })

  it("**工具结果要并回那次调用**，否则界面上它永远停在「正在跑」", () => {
    const items = toItems(
      [
        user("跑一下"),
        assistant([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]),
        { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
      ],
      0,
    )
    const call = items.find((i) => i.kind === "tool_call")
    expect(call?.kind === "tool_call" ? call.status : "").toBe("ok")
  })

  it("失败的工具结果标 failed", () => {
    const items = toItems(
      [
        user("跑"),
        assistant([{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
        {
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "boom", is_error: true }] },
        },
      ],
      0,
    )
    const call = items.find((i) => i.kind === "tool_call")
    expect(call?.kind === "tool_call" ? call.status : "").toBe("failed")
  })

  it("**子 agent 的往来整段跳过**：那是另一段对话，混进主线像它在自言自语", () => {
    const items = toItems([user("主线"), user("子任务", { isSidechain: true })], 0)
    expect(items).toHaveLength(1)
  })

  it("**压缩注入的摘要跳过**：它不是人打的，摆成用户消息会看到一条几千字的「自己说的话」", () => {
    const items = toItems([user("摘要…", { isCompactSummary: true })], 0)
    expect(items).toEqual([])
  })

  it("元数据行（标题、模式、队列）不是对话内容", () => {
    const items = toItems([{ type: "custom-title", customTitle: "x" }, { type: "mode" }], 0)
    expect(items).toEqual([])
  })

  it("时间戳按记录里的走，认不出才用「现在」", () => {
    const items = toItems([user("话")], 999)
    expect(items[0]?.at).toBe(new Date("2026-08-16T00:00:00.000Z").getTime())
    expect(toItems([{ type: "user", message: { role: "user", content: "话" } }], 999)[0]?.at).toBe(999)
  })

  it("配不上任何调用的工具结果直接丢——那次调用不在这段历史里", () => {
    const items = toItems(
      [{ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "没见过", content: "x" }] } }],
      0,
    )
    expect(items).toEqual([])
  })
})

describe("账号：只取身份，不碰凭据", () => {
  const of = (account: unknown): string => JSON.stringify({ oauthAccount: account })

  it("**名字优先于邮箱**——侧栏那一行里一串隐私转发邮箱既认不出人又要截断", () => {
    const got = parseAccount(
      of({ displayName: "alice", emailAddress: "x@privaterelay.appleid.com", organizationType: "claude_max" }),
    )
    expect(got).toEqual({ label: "alice", plan: "claude_max" })
  })

  it("没有名字才退回邮箱", () => {
    expect(parseAccount(of({ emailAddress: "a@b.com" }))?.label).toBe("a@b.com")
  })

  it("两样都没有就当没登录——一行只有套餐名说不清是谁", () => {
    expect(parseAccount(of({ organizationType: "claude_max" }))).toBeUndefined()
  })

  it("文件读不到、或者不是 JSON，都不能崩", () => {
    expect(parseAccount("")).toBeUndefined()
    expect(parseAccount("{ 这不是 json")).toBeUndefined()
    expect(parseAccount("{}")).toBeUndefined()
  })
})
