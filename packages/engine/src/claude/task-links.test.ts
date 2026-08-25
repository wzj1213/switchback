import { describe, expect, it } from "vitest"
import { createTaskLinks, rememberTaskParent, taskIdForParent } from "./task-links.js"

describe("Claude task 与 sidechain 父工具对应", () => {
  it("只接受两端都有非空原生 id 的公开消息", () => {
    const links = createTaskLinks()
    rememberTaskParent(links, "agent-a", { tool_use_id: "tool-a" })
    rememberTaskParent(links, "agent-b", { tool_use_id: "" })
    rememberTaskParent(links, "agent-c", { tool_use_id: 3 })
    expect(taskIdForParent(links, "tool-a")).toBe("agent-a")
    expect([...links.parents]).toEqual([["tool-a", "agent-a"]])
  })
})
