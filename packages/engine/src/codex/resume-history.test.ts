import { describe, expect, it } from "vitest"
import { createCodexDriver } from "./driver.js"
import { toCodexTranscript, type CodexHistoryThread } from "./history.js"

const FAKE_RESUME_SERVER = String.raw`
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim() === "") continue;
    const request = JSON.parse(line);
    if (request.id === undefined) continue;
    let result = {};
    if (request.method === "thread/resume") {
      result = { thread: { id: "native-resumed", turns: [{ id: "native-turn", itemsView: "full",
        status: "completed", startedAt: 7, items: [
          { type: "userMessage", id: "native-user", content: [{ type: "text", text: "原生旧消息" }] },
          { type: "agentMessage", id: "native-agent", text: "原生旧回答", phase: "final_answer" }
        ] }] } };
    } else if (request.method === "account/read") result = { account: null };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
  }
});
`

describe("Codex resume 正文", () => {
  it("正式驱动保留 resume 同一发回包，接管读取不再得到空数组", async () => {
    const session = await createCodexDriver({
      command: process.execPath,
      args: ["-e", FAKE_RESUME_SERVER],
      reclaim: { exitGraceMs: 200, termGraceMs: 200, killGraceMs: 200 },
    }).start({
      threadId: "omni-thread",
      resume: "native-requested",
      cwd: process.cwd(),
      home: "/h",
      trust: "read-only",
      memory: () => [],
      emit: () => undefined,
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      const got = await session.transcript?.()
      expect(got?.items.map((item) => item.kind)).toEqual(["user_message", "agent_message"])
      expect(got?.items[0]).toMatchObject({ text: "原生旧消息", at: 7000 })
    } finally {
      await session.dispose()
    }
  })

  it("按生产 thread.turns 形状恢复人话、图片、回答与工具结果", () => {
    const thread: CodexHistoryThread = {
      id: "native-thread",
      turns: [
        {
          id: "native-turn",
          itemsView: "full",
          status: "completed",
          startedAt: 1_787_631_679,
          completedAt: 1_787_631_686,
          items: [
            {
              type: "userMessage",
              id: "u1",
              content: [
                { type: "text", text: "看看这三张图" },
                { type: "localImage", path: "/w/a.png" },
                { type: "localImage", path: "/w/b.png" },
              ],
            },
            { type: "agentMessage", id: "a1", text: "看到了" },
            {
              type: "commandExecution",
              id: "c1",
              command: "pnpm test",
              cwd: "/w",
              status: "completed",
              exitCode: 0,
              aggregatedOutput: "ok\n",
            },
          ],
        },
      ],
    }

    const got = toCodexTranscript(thread, 9)
    expect(got.total).toBe(3)
    expect(got.items.map((item) => item.kind)).toEqual([
      "user_message",
      "agent_message",
      "tool_call",
    ])
    expect(got.items[0]).toMatchObject({
      id: "u1",
      turnId: "native-turn",
      at: 1_787_631_679_000,
      text: "看看这三张图",
      attachments: ["/w/a.png", "/w/b.png"],
    })
    expect(got.items[2]).toMatchObject({
      kind: "tool_call",
      status: "ok",
      detail: { kind: "shell", command: "pnpm test", exitCode: 0, output: "ok\n" },
    })
  })

  it("同轮 steer 人话保留同一轮身份，内部提示、活动帧和空推理不混进正文", () => {
    const got = toCodexTranscript(
      {
        turns: [
          {
            id: "t1",
            status: "completed",
            startedAt: 2,
            itemsView: "full",
            items: [
              { type: "hookPrompt", id: "hidden" },
              { type: "userMessage", id: "u1", content: [{ type: "text", text: "先做 A" }] },
              { type: "userMessage", id: "u2", content: [{ type: "text", text: "改成 B" }] },
              { type: "reasoning", id: "r1", summary: [], content: [] },
              { type: "subAgentActivity", id: "s1" },
            ],
          },
        ],
      },
      9,
    )
    expect(got.items.map((item) => [item.id, item.turnId])).toEqual([
      ["u1", "t1"],
      ["u2", "t1"],
    ])
  })

  it("失败轮保留原生错误，缺失时间才回落到调用时刻", () => {
    const got = toCodexTranscript(
      {
        turns: [
          {
            id: "t-fail",
            status: "failed",
            itemsView: "full",
            items: [],
            error: { message: "model overloaded" },
          },
        ],
      },
      123,
    )
    expect(got.items).toEqual([
      {
        id: "history-error-t-fail",
        turnId: "t-fail",
        at: 123,
        kind: "error",
        message: "model overloaded",
        fatal: true,
      },
    ])
  })

  it("对端明确只给摘要时不把半份记录冒充完整 transcript", () => {
    const got = toCodexTranscript(
      {
        turns: [
          {
            id: "t-summary",
            itemsView: "summary",
            items: [{ type: "agentMessage", id: "last", text: "只有最后一句" }],
          },
        ],
      },
      1,
    )
    expect(got).toEqual({ items: [], total: 0 })
  })

  it("超长会话只复制最近 1500 条，同时如实保留总数", () => {
    const items = Array.from({ length: 1502 }, (_, index) => ({
      type: "agentMessage",
      id: `a${String(index)}`,
      text: `回答 ${String(index)}`,
    }))
    const got = toCodexTranscript({ turns: [{ id: "t", itemsView: "full", items }] }, 1)
    expect(got.total).toBe(1502)
    expect(got.items).toHaveLength(1500)
    expect(got.items[0]?.id).toBe("a2")
    expect(got.items.at(-1)?.id).toBe("a1501")
  })
})
