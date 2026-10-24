import type { ElicitationRequest } from "@anthropic-ai/claude-agent-sdk"
import type { QuestionPrompt, QuestionResponse } from "@switchback/protocol"
import { describe, expect, it, vi } from "vitest"
import type { StartRequest } from "../contract.js"
import { answerElicitation } from "./elicitation.js"

const request = (patch: Partial<ElicitationRequest> = {}): ElicitationRequest => ({
  serverName: "calendar",
  displayName: "日历连接器",
  message: "请补齐会议参数",
  mode: "form",
  ...patch,
})

const controller = (): AbortController => new AbortController()

describe("Claude MCP 结构化 elicitation", () => {
  it("把公开的扁平 schema 逐项呈现并按原始类型回送", async () => {
    let shown: readonly QuestionPrompt[] = []
    const ask: StartRequest["askQuestion"] = (questions) => {
      shown = questions
      return Promise.resolve({ answers: {
        name: { kind: "note", text: "switchback" },
        count: { kind: "note", text: "3" },
        notify: { kind: "single", optionId: "true" },
        color: { kind: "single", optionId: "#f00" },
        tags: { kind: "multi", optionIds: ["fast", "safe"] },
        nickname: { kind: "skipped" },
      } })
    }
    const result = await answerElicitation(request({
      description: "只发送给该 MCP\u001b[31m",
      requestedSchema: {
        type: "object",
        required: ["name", "count", "notify", "color", "tags"],
        properties: {
          name: { type: "string", title: "会议名", minLength: 2 },
          count: { type: "integer", title: "人数", minimum: 1, maximum: 10 },
          notify: { type: "boolean", title: "发通知" },
          color: { type: "string", title: "颜色", oneOf: [
            { const: "#f00", title: "红色" }, { const: "#00f", title: "蓝色" },
          ] },
          tags: { type: "array", title: "标签", minItems: 1, maxItems: 2, items: { anyOf: [
            { const: "fast", title: "快速" }, { const: "safe", title: "稳妥" },
          ] } },
          nickname: { type: "string", title: "别名" },
        },
      },
    }), ask, controller().signal)

    expect(shown).toHaveLength(6)
    expect(shown[0]).toMatchObject({ header: "日历连接器 · calendar", question: "会议名" })
    expect(shown[0]?.body).toContain("只发送给该 MCP [31m")
    expect(shown[0]?.body).not.toContain("\u001b")
    expect(shown[4]).toMatchObject({ multiSelect: true, options: [
      { id: "fast", label: "快速" }, { id: "safe", label: "稳妥" },
    ] })
    expect(shown[5]).toMatchObject({ optional: true })
    expect(result).toEqual({ action: "accept", content: {
      name: "switchback", count: 3, notify: true, color: "#f00", tags: ["fast", "safe"],
    } })
  })

  it("类型或范围不符时把原始问题带错误重问，不发脏值", async () => {
    const seen: (readonly QuestionPrompt[])[] = []
    const replies: QuestionResponse[] = [
      { answers: { count: { kind: "note", text: "2.5" } } },
      { answers: { count: { kind: "note", text: "4" } } },
    ]
    const result = await answerElicitation(request({ requestedSchema: {
      type: "object", required: ["count"], properties: { count: { type: "integer", title: "人数" } },
    } }), (questions) => {
      seen.push(questions)
      return Promise.resolve(replies.shift() ?? { dismissed: true })
    }, controller().signal)

    expect(seen).toHaveLength(2)
    expect(seen[1]?.[0]?.body).toContain("请输入整数")
    expect(result).toEqual({ action: "accept", content: { count: 4 } })
  })

  it("英文界面的重问提示说英文；字段名是服务器写的，原样保留", async () => {
    const seen: (readonly QuestionPrompt[])[] = []
    const replies: QuestionResponse[] = [
      { answers: { count: { kind: "note", text: "2.5" } } },
      { answers: { count: { kind: "note", text: "4" } } },
    ]
    await answerElicitation(request({ requestedSchema: {
      type: "object", required: ["count"], properties: { count: { type: "integer", title: "人数" } },
    } }), (questions) => {
      seen.push(questions)
      return Promise.resolve(replies.shift() ?? { dismissed: true })
    }, controller().signal, "en")

    expect(seen[1]?.[0]?.body).toContain("人数: enter a whole number")
  })

  it("没有字段的原生确认仍由人决定，不自动放行", async () => {
    const result = await answerElicitation(request({ requestedSchema: {
      type: "object", properties: {},
    } }), (questions) => {
      expect(questions[0]).toMatchObject({ question: "请补齐会议参数", options: [{ id: "accept", label: "继续" }] })
      return Promise.resolve({ answers: { "mcp-confirm": { kind: "single", optionId: "accept" } } })
    }, controller().signal)
    expect(result).toEqual({ action: "accept", content: {} })
  })

  it("用户跳过是明确拒绝，引擎撤销则是取消", async () => {
    const alive = controller()
    await expect(answerElicitation(request(), () => Promise.resolve({ dismissed: true }), alive.signal))
      .resolves.toEqual({ action: "decline" })

    const cancelled = controller()
    await expect(answerElicitation(request(), () => {
      cancelled.abort()
      return Promise.resolve({ dismissed: true })
    }, cancelled.signal)).resolves.toEqual({ action: "cancel" })
  })

  it("URL 模式展示完整地址并只把人的明确同意回成 accept", async () => {
    const result = await answerElicitation(request({
      mode: "url",
      url: "https://mcp.example.com/connect?flow=one",
      elicitationId: "el-one",
    }), (questions) => {
      expect(questions[0]).toMatchObject({
        external: { url: "https://mcp.example.com/connect?flow=one" },
        options: [{ id: "accept", label: "我已核对地址，同意继续" }],
      })
      return Promise.resolve({ answers: { "mcp-url": { kind: "single", optionId: "accept" } } })
    }, controller().signal)
    expect(result).toEqual({ action: "accept" })
  })

  it("协议外 schema 明确取消，不制造空答案", async () => {
    const ask = vi.fn<StartRequest["askQuestion"]>()
    const cases: readonly ElicitationRequest[] = [
      request({ requestedSchema: { type: "object", properties: { nested: { type: "object" } } } }),
      request({ requestedSchema: { type: "object", properties: {
        broken: { type: "string", enum: ["a"], enumNames: [] },
      } } }),
    ]
    for (const value of cases) {
      await expect(answerElicitation(value, ask, controller().signal)).resolves.toEqual({ action: "cancel" })
    }
    expect(ask).not.toHaveBeenCalled()
  })
})
