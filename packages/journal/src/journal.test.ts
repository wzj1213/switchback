import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Event, Thread } from "@omni/protocol"
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
    state.dir = await mkdtemp(join(tmpdir(), "omni-journal-"))
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

  it("item.delta 不落盘", async () => {
    const j = createJournal({ dir: state.dir })
    await j.append("th-1", started("th-1"))
    await j.append("th-1", { type: "item.delta", at: 3, itemId: "x", append: "y" })
    expect(await j.read("th-1")).toHaveLength(1)
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

  it("超过上限就停笔——无声地把磁盘写满是不能接受的", async () => {
    const j = createJournal({ dir: state.dir, maxBytes: 200 })
    for (let i = 0; i < 20; i += 1) await j.append("th-1", message("tn", `第${String(i)}条`))
    const text = await readFile(join(state.dir, "th-1.jsonl"), "utf8")
    expect(text.length).toBeLessThan(500)
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

  it("目录里的杂物不当成会话", async () => {
    const j = createJournal({ dir: state.dir })
    await j.append("th-1", started("th-1"))
    await writeFile(join(state.dir, "README.txt"), "x")
    expect(await j.list()).toEqual(["th-1"])
  })
})
