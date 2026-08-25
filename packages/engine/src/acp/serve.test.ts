import { describe, expect, it } from "vitest"
import { createRpc } from "../rpc.js"
import { answerCall } from "./serve.js"

describe("ACP 反向请求错误应答", () => {
  it("未认领方法走 JSON-RPC 顶层 error，不伪装成成功 result", () => {
    const sent: string[] = []
    const rpc = createRpc({
      send: (line) => sent.push(line),
      onNotification: () => undefined,
      onRequest: (call) => void answerCall({
        terminal: undefined,
        permission: () => ({
          engine: "acp:test", cwd: "/w", home: "/home/u", trust: () => "read-only",
          memory: () => [], inflight: new Map(), askUser: () => Promise.resolve({ allow: false, remember: "once" }),
        }),
      }, call),
    })

    rpc.feed('{"jsonrpc":"2.0","id":9,"method":"future/method","params":{}}\n')

    expect(sent.map((line) => JSON.parse(line))).toEqual([{
      jsonrpc: "2.0", id: 9, error: { code: -32601, message: "omni 未认领 future/method" },
    }])
  })
})
