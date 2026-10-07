import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Event, Item, Thread } from "@switchback/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { createAttachmentFiles, thumbnailSize } from "./attachment-files.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; dir: string }> {
  const root = await mkdtemp(join(tmpdir(), "switchback-attachment-files-"))
  const dir = join(root, "attachments")
  roots.push(root)
  await mkdir(dir)
  return { root, dir }
}

const user = (turnId: string, paths: readonly string[]): Event => ({
  type: "item.started",
  at: 2,
  item: {
    id: `it-${turnId}`, turnId, at: 2, kind: "user_message", text: "看图", attachments: paths,
  } satisfies Item,
})

const turn = (id: string, threadId: string): Event => ({
  type: "turn.started",
  at: 1,
  turn: { id, threadId, engine: "codex", status: "running", startedAt: 1 },
})

const thread = (id: string, draft: readonly string[], queued: readonly string[]): Event => ({
  type: "thread.updated",
  at: 1,
  thread: {
    id, title: id, cwd: "/work", engine: "codex", trust: "auto-edit", status: "idle",
    createdAt: 1, updatedAt: 1, engineHistory: ["codex"],
    draftAttachments: draft, queued: queued.map(() => "稍后发"), queuedAttachments: queued.map((path) => [path]),
  } satisfies Thread,
})

const exists = async (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

function pathsIn(dir: string): {
  old: string; fresh: string; history: string; shared: string; draft: string; queued: string
} {
  return {
    old: join(dir, "old.png"), fresh: join(dir, "fresh.png"),
    history: join(dir, "history.png"), shared: join(dir, "shared.png"),
    draft: join(dir, "draft.png"), queued: join(dir, "queued.png"),
  }
}

describe("粘贴图片文件所有权", () => {
  it("只回收 Switchback 管理且没有历史引用的图片；共享引用等最后一条会话删除", async () => {
    const { root, dir } = await fixture()
    const paths = pathsIn(dir)
    const external = join(root, "original.png")
    const picked = join(root, "picked.png")
    await Promise.all([...Object.values(paths), external, picked].map((path) => writeFile(path, "png")))
    const now = Date.now()
    await utimes(paths.old, new Date(now - 8 * 86_400_000), new Date(now - 8 * 86_400_000))

    const files = createAttachmentFiles(dir)
    expect(files.allows(paths.fresh)).toBe(true)
    expect(files.allows(external)).toBe(false)
    files.allow([picked, "relative.png"])
    expect(files.allows(picked)).toBe(true)
    expect(files.allows("relative.png")).toBe(false)
    files.noteHistory("th-a", [
      user("tn-a", [paths.history, paths.shared, external]),
      thread("th-a", [paths.draft], [paths.queued]),
    ])
    files.noteHistory("th-b", [user("tn-b", [paths.shared])])
    expect(files.allows(external)).toBe(true)

    await expect(files.pruneOnce(now)).resolves.toBe(1)
    expect(await exists(paths.old)).toBe(false)
    expect(await Promise.all([paths.fresh, paths.history, paths.shared, paths.draft, paths.queued].map(exists)))
      .toEqual([true, true, true, true, true])
    await expect(files.pruneOnce(now + 100 * 86_400_000)).resolves.toBe(0)

    await expect(files.discard([paths.fresh, paths.history, external])).resolves.toBe(1)
    expect(await Promise.all([exists(paths.fresh), exists(paths.history), exists(external)]))
      .toEqual([false, true, true])
    await expect(files.removeThread("th-a")).resolves.toBe(3)
    expect(await Promise.all([paths.history, paths.draft, paths.queued, paths.shared].map(exists)))
      .toEqual([false, false, false, true])
    expect(files.allows(external)).toBe(false)
    expect(files.allows(picked)).toBe(true)
    await expect(files.removeThread("th-b")).resolves.toBe(1)
    expect(await exists(paths.shared)).toBe(false)
  })

  it("直播事件按 turn 认领图片，认不出归属的 item 不会获得保护", async () => {
    const { dir } = await fixture()
    const kept = join(dir, "kept.png")
    const orphan = join(dir, "orphan.png")
    await Promise.all([kept, orphan].map((path) => writeFile(path, "png")))
    const files = createAttachmentFiles(dir)
    files.note(user("unknown", [orphan]))
    files.note(turn("tn-live", "th-live"))
    files.note(user("tn-live", [kept]))

    await expect(files.discard([kept, orphan])).resolves.toBe(1)
    expect(await Promise.all([exists(kept), exists(orphan)])).toEqual([true, false])
    await expect(files.removeThread("th-live")).resolves.toBe(1)
    expect(await exists(kept)).toBe(false)
  })

  it.each([
    [undefined, undefined], [Number.NaN, undefined], [0, undefined], [-1, undefined],
    [1.9, 1], [144, 144], [2000, 2000], [999_999, 2048],
  ])("缩略图边长 %s 收口为 %s", (input, expected) => {
    expect(thumbnailSize(input)).toBe(expected)
  })
})

describe("数据目录挪过地方", () => {
  it("会话里记的还是旧目录的路径：七天前的图按文件名认出来，不当孤儿删", async () => {
    const { root, dir } = await fixture()
    const kept = join(dir, "20260825-105200-kept.png")
    const orphan = join(dir, "orphan.png")
    await Promise.all([kept, orphan].map((path) => writeFile(path, "png")))
    const past = new Date(Date.now() - 8 * 86_400_000)
    await Promise.all([kept, orphan].map((path) => utimes(path, past, past)))

    const files = createAttachmentFiles(dir)
    files.noteHistory("th-old", [user("tn-old", [join(root, "omni", "attachments", "20260825-105200-kept.png")])])
    expect(await files.pruneOnce(Date.now())).toBe(1)
    expect(await exists(kept)).toBe(true)
    expect(await exists(orphan)).toBe(false)
  })
})
