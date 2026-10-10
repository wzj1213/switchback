import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { StoredDraft } from "../shared/drafts.js"

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))
const { createDraftStore } = await import("./drafts.js")

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchback-drafts-"))
  roots.push(root)
  return join(root, "drafts.json")
}

const log = { write: vi.fn() } as never
const draft = (patch: Partial<StoredDraft> = {}): StoredDraft => ({
  engine: "codex", text: "写到一半", attachments: [], blocks: [], aside: false, at: 1, ...patch,
})

function store(file: string, exists: (path: string) => boolean = () => true) {
  const holds = new Map<string, readonly string[]>()
  const drafts = createDraftStore({ file, log, exists, delayMs: 0, hold: (owner, paths) => holds.set(owner, paths) })
  return { drafts, holds }
}

describe("没发出去的草稿落盘", () => {
  it("存下、退出前补写，重启后原样读回", async () => {
    const file = await fixture()
    const first = store(file)
    first.drafts.save("th-1", draft())
    first.drafts.flush()
    expect(store(file).drafts.load().drafts).toEqual({ "th-1": draft() })
  })

  it("空的就是删；会话删了草稿一起删", async () => {
    const file = await fixture()
    const { drafts } = store(file)
    drafts.save("th-1", draft())
    drafts.save("th-2", draft())
    drafts.save("th-1", draft({ text: "" }))
    drafts.forget("th-2")
    drafts.flush()
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({})
  })

  it("读盘时不在了的图拿掉并数出来，只报一次", async () => {
    const file = await fixture()
    await writeFile(file, JSON.stringify({ "th-1": draft({ attachments: ["/gone.png", "/kept.png"] }) }))
    const { drafts, holds } = store(file, (path) => path === "/kept.png")
    const loaded = drafts.load()
    expect(loaded.drafts["th-1"]?.attachments).toEqual(["/kept.png"])
    expect(loaded.missing).toEqual({ "th-1": 1 })
    expect(drafts.load().missing).toEqual({})
    // 草稿里的图算在用：孤儿清理据此不删
    expect(holds.get("draft:th-1")).toEqual(["/kept.png"])
  })

  it("草稿去掉一张图、或者整份删掉：对那张图放手", async () => {
    const file = await fixture()
    const { drafts, holds } = store(file)
    drafts.save("th-1", draft({ attachments: ["/a.png", "/b.png"] }))
    drafts.save("th-1", draft({ attachments: ["/b.png"] }))
    expect(holds.get("draft:th-1")).toEqual(["/b.png"])
    drafts.forget("th-1")
    expect(holds.get("draft:th-1")).toEqual([])
  })

  it("坏掉的文件当没有，不掀翻启动", async () => {
    const file = await fixture()
    await writeFile(file, "{坏的")
    expect(store(file).drafts.load().drafts).toEqual({})
  })
})
