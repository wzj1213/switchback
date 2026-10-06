import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { scanLines, searchThreads, snippetOf, termsOf } from "./search.js"

const line = (kind: string, text: string, at = 1, id = `${kind}-${String(at)}`): string =>
  JSON.stringify({ type: "item.started", at, item: { id, turnId: "t", kind, at, text } })

const tool = (detail: string): string =>
  JSON.stringify({
    type: "item.started",
    at: 1,
    item: { id: "i", turnId: "t", kind: "tool_call", tool: "Bash", status: "ok", detail: { kind: "shell", command: detail } },
  })

const dir = { path: "" }

beforeAll(() => {
  dir.path = mkdtempSync(join(tmpdir(), "switchback-search-"))
  writeFileSync(
    join(dir.path, "th-aaa.jsonl"),
    [
      JSON.stringify({ type: "thread.started", at: 1, thread: { id: "th-aaa", title: "无关标题" } }),
      line("user_message", "把流式输出改掉", 100),
      line("agent_message", "好的，我把 Switchback 的流式渲染换成增量的", 200),
      tool("git diff --stat"),
    ].join("\n"),
  )
  writeFileSync(
    join(dir.path, "th-bbb.jsonl"),
    [line("user_message", "这里的审批规则要不要收紧", 300), line("agent_message", "收紧到只对写操作发问", 400)].join("\n"),
  )
  // 只在工具行里出现的词：**不该命中**
  writeFileSync(join(dir.path, "th-ccc.jsonl"), [tool("rg 流式 --files-with-matches"), line("user_message", "跑一下", 500)].join("\n"))
  // 不是会话记录的文件，别去读
  writeFileSync(join(dir.path, "notes.txt"), "流式")
})

afterAll(() => {
  if (dir.path !== "") rmSync(dir.path, { recursive: true, force: true })
})

/**
 * 这条搜索是「那句话在哪条会话里」的**唯一入口**——会话不在文件管理器里、
 * 不在浏览器历史里，搜不到就等于没有。所以每一条筛掉的规则都得有理由。
 */
describe("searchThreads", () => {
  it("正文中间那句话搜得到（侧栏那份筛选搜不到它）", async () => {
    const out = await searchThreads(dir.path, "增量")
    expect(out.hits.map((h) => h.threadId)).toEqual(["th-aaa"])
  })

  it("多个词是「与」，但**不要求在同一条消息里**", async () => {
    // 「流式」在用户那句，「增量」在它的回答里
    const out = await searchThreads(dir.path, "流式 增量")
    expect(out.hits.map((h) => h.threadId)).toEqual(["th-aaa"])
  })

  it("有一个词全篇没出现就不算命中——按或处理的话词越加结果越多，和直觉相反", async () => {
    expect((await searchThreads(dir.path, "流式 根本没提过的词")).hits).toEqual([])
  })

  it("**只出现在工具调用里的词不算**：不然搜什么都命中跑过命令的那几条", async () => {
    const out = await searchThreads(dir.path, "流式")
    expect(out.hits.map((h) => h.threadId)).not.toContain("th-ccc")
  })

  it("按最近说过的排前面", async () => {
    const out = await searchThreads(dir.path, "的")
    expect(out.hits[0]?.at).toBeGreaterThanOrEqual(out.hits[out.hits.length - 1]?.at ?? 0)
  })

  it("不是 th-*.jsonl 的文件不读", async () => {
    const out = await searchThreads(dir.path, "流式")
    expect(out.hits.every((h) => h.threadId.startsWith("th-"))).toBe(true)
  })

  it("空查询直接空手回，不去翻盘", async () => {
    expect(await searchThreads(dir.path, "   ")).toEqual({ hits: [], skipped: 0 })
  })

  it("目录不存在时返回空，不抛", async () => {
    expect((await searchThreads(join(dir.path, "没有这个目录"), "流式")).hits).toEqual([])
  })

  it("回的是条数和摘要，不是整条会话", async () => {
    const hit = (await searchThreads(dir.path, "流式")).hits[0]
    expect(hit?.count).toBe(2)
    expect(hit?.snippet).toContain("流式")
  })
})

describe("snippetOf", () => {
  it("**以命中的词为中心截**，不是从头截", () => {
    const text = `${"前".repeat(300)}关键词${"后".repeat(300)}`
    const snip = snippetOf(text, ["关键词"])
    expect(snip).toContain("关键词")
    expect(snip.startsWith("…")).toBe(true)
    expect(snip.endsWith("…")).toBe(true)
  })

  it("短的原样给，不补省略号", () => {
    expect(snippetOf("就这么短", ["短"])).toBe("就这么短")
  })

  it("换行压成空格：侧栏一行放不下多行", () => {
    expect(snippetOf("上一行\n下一行", ["下"])).toBe("上一行 下一行")
  })
})

describe("termsOf", () => {
  it("空白分词、转小写、丢空串", () => {
    expect(termsOf("  Foo   BAR ")).toEqual(["foo", "bar"])
    expect(termsOf("")).toEqual([])
  })
})

describe("scanLines", () => {
  it("坏行跳过，不整个失败——一条写了一半的记录不该让搜索瞎掉", () => {
    const out = scanLines(["{不是 json", line("user_message", "还在这儿")], ["还在"])
    expect(out?.count).toBe(1)
  })

  it("只认同一 item 的最终快照，旧文本不会重复计数或继续命中", () => {
    const started = line("agent_message", "旧版里有关键词", 1, "i1")
    const updated = JSON.stringify({
      type: "item.updated", at: 2,
      item: { id: "i1", turnId: "t", kind: "agent_message", at: 1, text: "最终内容" },
    })
    expect(scanLines([started, updated], ["关键词"])).toBeUndefined()
  })

  it("撤回是搜索墓碑，被撤掉的正文不能从旧日志行里复活", () => {
    const started = line("agent_message", "这段拒答应被撤回", 1, "i1")
    const removed = JSON.stringify({ type: "item.removed", at: 2, turnId: "t", itemId: "i1" })
    expect(scanLines([started, removed], ["拒答"])).toBeUndefined()
  })
})
