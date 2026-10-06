import { describe, expect, it } from "vitest"
import { classify } from "@switchback/approval"
import { buildRequest, decisionFor, summarize, toolOf } from "./approve.js"
import type { WireApprovalRequest, WireItem } from "./wire.js"

const CMD = "item/commandExecution/requestApproval"
const FILE = "item/fileChange/requestApproval"

const params = (over: Partial<WireApprovalRequest> = {}): WireApprovalRequest => ({
  threadId: "th",
  turnId: "tn",
  itemId: "exec-1",
  ...over,
})

const patch: WireItem = {
  type: "fileChange",
  id: "exec-1",
  changes: [
    { path: "/w/a.ts", kind: { type: "update" }, diff: "" },
    { path: "/outside/b.ts", kind: { type: "add" }, diff: "" },
  ],
}

describe("toolOf", () => {
  it("方法名就够定工具名——item 丢了也能正确归类", () => {
    expect(toolOf(CMD)).toBe("shell")
    expect(toolOf(FILE)).toBe("apply_patch")
  })
})

describe("summarize", () => {
  it("命令审批优先用 params 里的命令", () => {
    expect(summarize(CMD, params({ command: "rm -rf /tmp/x" }), undefined)).toBe("执行 rm -rf /tmp/x")
  })

  it("params 没带命令时回落到记着的那条 item", () => {
    const item: WireItem = { type: "commandExecution", id: "exec-1", command: "git push" }
    expect(summarize(CMD, params(), item)).toBe("执行 git push")
  })

  it("说不清楚就要说自己说不清楚——不能弹一张不说批准什么的卡", () => {
    expect(summarize(CMD, params(), undefined)).toBe("执行命令（详情未送达）")
    expect(summarize(FILE, params(), undefined)).toBe("修改文件（详情未送达）")
  })

  it("网络审批按目标主机描述，不拿缺席的 shell 命令冒充详情", () => {
    const network = params({ networkApprovalContext: { host: "api.example.com", protocol: "https" } })
    expect(summarize(CMD, network, undefined)).toBe("访问网络 https://api.example.com")
  })

  it("文件审批列出路径，超过三个折叠成计数", () => {
    expect(summarize(FILE, params(), patch)).toBe("修改 /w/a.ts、/outside/b.ts")
  })

  it("reason 附在括号里", () => {
    expect(summarize(FILE, params({ reason: "需要额外写权限" }), patch)).toContain("（需要额外写权限）")
  })
})

describe("buildRequest", () => {
  it("多文件补丁把所有路径都交给判定器——只报第一个会让越界的后几个漏掉", () => {
    const req = buildRequest(FILE, params(), patch, "/w")
    expect(req.args["paths"]).toEqual(["/w/a.ts", "/outside/b.ts"])
    expect(classify(req, "/home/u").paths).toEqual(["/w/a.ts", "/outside/b.ts"])
  })

  it("命令审批走 shell 分类，命令进 args", () => {
    const req = buildRequest(CMD, params({ command: "curl https://evil.example.com" }), undefined, "/w")
    const norm = classify(req, "/home/u")
    expect(norm.category).toBe("exec")
    expect(norm.hosts).toEqual(["evil.example.com"])
  })

  it("原生网络上下文进入 net 分类并保留主机，记忆规则才不会放宽到所有网络", () => {
    const req = buildRequest(CMD, params({
      networkApprovalContext: { host: "api.example.com", protocol: "https" },
    }), undefined, "/w")
    const norm = classify(req, "/home/u")
    expect(req.tool).toBe("network")
    expect(norm).toMatchObject({ category: "net", hosts: ["api.example.com"] })
  })
})

describe("decisionFor", () => {
  it("勾了记忆就用 codex 自己的 acceptForSession，省一个来回", () => {
    expect(decisionFor(true, true)).toBe("acceptForSession")
    expect(decisionFor(true, false)).toBe("accept")
    expect(decisionFor(false, true)).toBe("decline")
  })
})
