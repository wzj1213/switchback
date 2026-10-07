import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: {}, dialog: {} }))

const { lockHolderAlive, planLegacyMove, rewriteJournals, rewriteLine } = await import("./legacy-data-dir.js")

const NEW = "/Lib/Switchback"
const OLD = "/Lib/omni"

describe("改名后要不要搬旧数据目录", () => {
  // on：目录在、里面有东西；empty：目录在、但是空的（Electron 启动时先建好的那种）
  const cases: readonly [string, { current?: string; on: readonly string[]; empty?: readonly string[]; running?: boolean }, string][] = [
    ["只有旧目录：搬", { on: [OLD] }, "move"],
    ["新目录是 Electron 先建的空目录：照样搬", { on: [OLD], empty: [NEW] }, "move"],
    ["只有旧目录、旧应用还开着：拦", { on: [OLD], empty: [NEW], running: true }, "blocked"],
    ["新目录里已经有东西：不动", { on: [OLD, NEW] }, "none"],
    ["都没有（全新安装）：不动", { on: [], empty: [NEW] }, "none"],
    ["数据目录被指到别处（冒烟测试）：不动", { current: "/tmp/smoke", on: [OLD] }, "none"],
  ]
  for (const [name, c, expected] of cases) {
    it(name, () => {
      const plan = planLegacyMove({
        current: c.current ?? NEW,
        defaultDir: NEW,
        legacy: OLD,
        list: (path) => (c.on.includes(path) ? ["threads"] : c.empty?.includes(path) === true ? [] : undefined),
        legacyRunning: () => c.running === true,
      })
      expect(plan).toBe(expected)
    })
  }
})

describe("旧应用还在不在跑：看它的单例锁", () => {
  const dir = mkdtempSync(join(tmpdir(), "legacy-lock-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("没有锁：没在跑", () => {
    expect(lockHolderAlive(dir, () => true)).toBe(false)
  })

  it("锁指向的 pid 活着才算在跑", () => {
    symlinkSync("host.example-4242", join(dir, "SingletonLock"))
    expect(lockHolderAlive(dir, (pid) => pid === 4242)).toBe(true)
    expect(lockHolderAlive(dir, () => false)).toBe(false)
  })
})

const FROM = "/Lib/omni/attachments/"
const TO = "/Lib/Switchback/attachments/"
const line = (event: unknown): string => JSON.stringify(event)

describe("会话记录里的附件路径跟着搬", () => {
  const cases: readonly [string, string, string | undefined][] = [
    ["用户消息的附件改到新目录",
      line({ type: "item.started", item: { kind: "user_message", attachments: [`${FROM}a.png`, "/Users/me/Desktop/b.png"] } }),
      line({ type: "item.started", item: { kind: "user_message", attachments: [`${TO}a.png`, "/Users/me/Desktop/b.png"] } })],
    ["草稿与排队里的附件也改",
      line({ type: "thread.updated", thread: { draftAttachments: [`${FROM}d.png`], queuedAttachments: [[`${FROM}q.png`], []] } }),
      line({ type: "thread.updated", thread: { draftAttachments: [`${TO}d.png`], queuedAttachments: [[`${TO}q.png`], []] } })],
    ["引擎输出里顺带提到的旧路径是历史原文，不改",
      line({ type: "item.updated", item: { kind: "tool_call", output: `ls ${FROM}` } }), undefined],
    ["没有旧路径：不动", line({ type: "item.started", item: { attachments: [`${TO}a.png`] } }), undefined],
    ["不是 JSON：不动", `{ 坏了 ${FROM}`, undefined],
  ]
  for (const [name, before, after] of cases) {
    it(name, () => {
      expect(rewriteLine(before, FROM, TO)).toBe(after)
    })
  }

  it("整个目录逐行改，只改该改的行，不留临时文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "legacy-journals-"))
    try {
      mkdirSync(join(dir, "sub"))
      const kept = line({ type: "item.updated", item: { output: FROM } })
      const fixed = line({ type: "item.started", item: { attachments: [`${FROM}x.png`] } })
      writeFileSync(join(dir, "th-a.jsonl"), `${kept}\n${fixed}\n`)
      writeFileSync(join(dir, "notes.txt"), fixed)
      expect(rewriteJournals(dir, FROM, TO)).toBe(1)
      expect(readFileSync(join(dir, "th-a.jsonl"), "utf8")).toBe(`${kept}\n${line({ type: "item.started", item: { attachments: [`${TO}x.png`] } })}\n`)
      expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe(fixed)
      expect(readdirSync(dir).sort()).toEqual(["notes.txt", "sub", "th-a.jsonl"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
