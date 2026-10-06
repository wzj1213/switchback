import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync, mkdtempSync } from "node:fs"
import { Buffer } from "node:buffer"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Event, Thread } from "@switchback/protocol"
import { createJournal } from "./journal.js"

const thread = (id: string): Thread => ({
  id,
  title: id,
  cwd: "/w",
  engine: "codex",
  trust: "auto-edit",
  status: "idle",
  createdAt: 1,
  updatedAt: 1,
  engineHistory: ["codex"],
})

const started = (id: string): Event => ({ type: "thread.started", at: 1, thread: thread(id) })

const message = (turnId: string, text: string): Event => ({
  type: "item.started",
  at: 2,
  item: { id: `${turnId}-i`, turnId, kind: "agent_message", at: 2, text, complete: true },
})

describe("createJournal", () => {
  const state = { dir: "" }

  beforeEach(async () => {
    state.dir = await mkdtemp(join(tmpdir(), "switchback-journal-"))
  })

  afterEach(async () => {
    await rm(state.dir, { recursive: true, force: true })
  })

  it("写进去读得出来，顺序不变", async () => {
    const j = createJournal({ dir: join(state.dir, "threads") })
    await j.append("th-1", started("th-1"))
    await j.append("th-1", message("tn", "一"))
    await j.append("th-1", message("tn", "二"))
    const back = await j.read("th-1")
    expect(back).toHaveLength(3)
    expect(back[2]).toMatchObject({ item: { text: "二" } })
  })

  it("目录不存在会自己建——首次启动时它一定不存在", async () => {
    const j = createJournal({ dir: join(state.dir, "a", "b", "c") })
    await j.append("th-1", started("th-1"))
    expect(await j.read("th-1")).toHaveLength(1)
  })

  it("按会话分文件，互不串", async () => {
    const j = createJournal({ dir: state.dir })
    await j.append("th-1", started("th-1"))
    await j.append("th-2", started("th-2"))
    expect(await j.read("th-1")).toHaveLength(1)
    expect(await j.read("th-2")).toHaveLength(1)
  })

  it("普通 item.delta 不落盘；无终态快照的定向增量会保留", async () => {
    const j = createJournal({ dir: state.dir })
    await j.append("th-1", started("th-1"))
    await j.append("th-1", { type: "item.delta", at: 3, itemId: "x", append: "y" })
    await j.append("th-1", {
      type: "item.delta", at: 4, threadId: "th-1", itemId: "monitor", append: "kept",
    })
    expect(await j.read("th-1")).toEqual([
      started("th-1"),
      { type: "item.delta", at: 4, threadId: "th-1", itemId: "monitor", append: "kept" },
    ])
  })

  it("没写过的会话读出空数组，不是抛错", async () => {
    expect(await createJournal({ dir: state.dir }).read("never")).toEqual([])
  })

  it("残缺的最后一行只丢那一行——SIGKILL 之后这是常态", async () => {
    const j = createJournal({ dir: state.dir })
    await j.append("th-1", started("th-1"))
    await writeFile(join(state.dir, "th-1.jsonl"), '{"type":"item.st', { flag: "a" })
    expect(await j.read("th-1")).toHaveLength(1)
  })

  it("并发追加不会写出交错的半行", async () => {
    const j = createJournal({ dir: state.dir })
    await Promise.all(
      Array.from({ length: 40 }, (_, i) => j.append("th-1", message("tn", `第${String(i)}条`))),
    )
    const text = await readFile(join(state.dir, "th-1.jsonl"), "utf8")
    const lines = text.trim().split("\n")
    expect(lines).toHaveLength(40)
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow()
  })

  it("下一整行放不下就停笔，文件本身不能越过上限", async () => {
    const event = message("tn", "中文也必须按 UTF-8 字节算")
    const lineBytes = Buffer.byteLength(`${JSON.stringify(event)}\n`)
    const maxBytes = lineBytes * 2 - 1
    const j = createJournal({ dir: state.dir, maxBytes })
    await j.append("th-1", event)
    await j.append("th-1", event)
    const text = await readFile(join(state.dir, "th-1.jsonl"), "utf8")
    expect(Buffer.byteLength(text)).toBe(lineBytes)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(maxBytes)
  })

  it("落盘失败不抛——用户宁可丢历史也不愿丢正在进行的工作", async () => {
    // 传一个注定建不出来的目录（用一个已存在的文件当父目录）
    const file = join(state.dir, "not-a-dir")
    await writeFile(file, "x")
    const j = createJournal({ dir: join(file, "sub") })
    await expect(j.append("th-1", started("th-1"))).resolves.toBeUndefined()
  })

  it("list 按最近写过的排在前", async () => {
    const j = createJournal({ dir: state.dir })
    await j.append("th-old", started("th-old"))
    await new Promise((r) => setTimeout(r, 12))
    await j.append("th-new", started("th-new"))
    expect(await j.list()).toEqual(["th-new", "th-old"])
  })

  it("remove 删掉记录，之后读出空数组", async () => {
    const j = createJournal({ dir: state.dir })
    await j.append("th-1", started("th-1"))
    await j.remove("th-1")
    expect(await j.read("th-1")).toEqual([])
    expect(await j.list()).toEqual([])
  })

  it("删不存在的会话不抛——删除是幂等的", async () => {
    await expect(createJournal({ dir: state.dir }).remove("never")).resolves.toBeUndefined()
  })

  it("**删完之后再写，写不进去**（这条以前反着写，把隐患当成了契约）", async () => {
    // 旧版本这里断言的是「会重新建文件——所以宿主必须先停掉会话再删」。
    // 那不是契约，是**当时的行为恰好如此**：删除是用户的明确意图，
    // 而「先停会话再删」是一个没人能保证的时序约定——
    // 实测删一个正在刷输出的会话，残余 append 就把文件建回来了，
    // 而界面从此再也没有入口删第二次（回放要求含 user_message，
    // 写回来的只是尾巴几条），盘上留一个删不掉的完整正文。
    const j = createJournal({ dir: state.dir })
    await j.append("th-1", started("th-1"))
    await j.remove("th-1")
    await j.append("th-1", started("th-1"))
    expect(await j.read("th-1")).toHaveLength(0)
  })

  it("目录里的杂物不当成会话", async () => {
    const j = createJournal({ dir: state.dir })
    await j.append("th-1", started("th-1"))
    await writeFile(join(state.dir, "README.txt"), "x")
    expect(await j.list()).toEqual(["th-1"])
  })
})

describe("删会话不能被在途写入救回来", () => {
  it("**删除后残余的 append 不再把文件建回来**——否则盘上留一个界面里删不掉的残留", async () => {
    const dir = mkdtempSync(join(tmpdir(), "switchback-j-"))
    const j = createJournal({ dir })
    await j.append("th-1", started("th-1"))
    // 排一串在途写入，紧接着删——不等它们落定
    const pending = [1, 2, 3].map((n) => j.append("th-1", message("th-1", `第${String(n)}条`)))
    await j.remove("th-1")
    await Promise.all(pending)
    await j.flush()
    expect(existsSync(join(dir, "th-1.jsonl"))).toBe(false)
  })

  it("删完之后再来的 append 也写不进去", async () => {
    const dir = mkdtempSync(join(tmpdir(), "switchback-j-"))
    const j = createJournal({ dir })
    await j.append("th-1", started("th-1"))
    await j.remove("th-1")
    await j.append("th-1", message("th-1", "迟到的"))
    await j.flush()
    expect(existsSync(join(dir, "th-1.jsonl"))).toBe(false)
  })

  it("删一个不影响另一个", async () => {
    const dir = mkdtempSync(join(tmpdir(), "switchback-j-"))
    const j = createJournal({ dir })
    await j.append("th-1", started("th-1"))
    await j.append("th-2", started("th-2"))
    await j.remove("th-1")
    await j.append("th-2", message("th-2", "还在写"))
    await j.flush()
    expect(existsSync(join(dir, "th-2.jsonl"))).toBe(true)
    expect(await j.read("th-2")).toHaveLength(2)
  })
})

describe("写满了要出声", () => {
  it("**超限时叫一声**——停笔是对的，停得一声不响不对", async () => {
    const dir = await mkdtemp(join(tmpdir(), "switchback-full-"))
    const full: string[] = []
    // 上限设成 1 字节：第一条写进去，第二条就超
    const journal = createJournal({ dir, maxBytes: 1, onFull: (id) => full.push(id) })
    await journal.append("th-1", started("th-1"))
    await journal.append("th-1", started("th-1"))
    await journal.flush()
    expect(full).toEqual(["th-1"])
  })

  it("**每个会话只叫一次**：之后每条事件都叫等于刷屏", async () => {
    const dir = await mkdtemp(join(tmpdir(), "switchback-full-"))
    const full: string[] = []
    const journal = createJournal({ dir, maxBytes: 1, onFull: (id) => full.push(id) })
    for (let i = 0; i < 5; i += 1) await journal.append("th-1", started("th-1"))
    await journal.flush()
    expect(full).toHaveLength(1)
  })

  it("没写满就不叫", async () => {
    const dir = await mkdtemp(join(tmpdir(), "switchback-full-"))
    const full: string[] = []
    const journal = createJournal({ dir, onFull: (id) => full.push(id) })
    await journal.append("th-1", started("th-1"))
    await journal.flush()
    expect(full).toEqual([])
  })

  it("不给回调也不能崩——它是可选的", async () => {
    const dir = await mkdtemp(join(tmpdir(), "switchback-full-"))
    const journal = createJournal({ dir, maxBytes: 1 })
    await journal.append("th-1", started("th-1"))
    await expect(journal.append("th-1", started("th-1"))).resolves.toBeUndefined()
  })
})
