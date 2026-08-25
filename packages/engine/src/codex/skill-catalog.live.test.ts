import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createCodexDriver } from "./driver.js"

function writeSkill(path: string, description: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `---\nname: audit-live\ndescription: ${description}\n---\n\n# Audit live\n`)
}

async function waitForUpdated(events: readonly Event[]): Promise<Event> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const found = events.find(
      (event) =>
        event.type === "commands.updated" &&
        event.commands.some(
          (command) => command.name === "audit-live" && command.description === "after-change",
        ),
    )
    if (found !== undefined) return found
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("10 秒内没有收到刷新后的 commands.updated")
}

/**
 * 真起 Codex，验证文件 watcher 通知和 omni 的刷新链；默认 `pnpm test` 排除：
 * `pnpm vitest run --mode live packages/engine/src/codex/skill-catalog.live.test.ts`
 */
describe("Codex skill 热刷新（真机）", () => {
  it("项目 skill 改动后，运行中的会话收到新目录", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-codex-skill-live-"))
    const skill = join(cwd, ".agents", "skills", "audit-live", "SKILL.md")
    const events: Event[] = []
    writeSkill(skill, "before-change")
    const session = await createCodexDriver().start({
      threadId: "live-codex-skill",
      cwd,
      trust: "read-only",
      home: homedir(),
      memory: () => [],
      emit: (event) => events.push(event),
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      const before = await session.commands?.()
      expect(before).toContainEqual(expect.objectContaining({
        name: "audit-live",
        description: "before-change",
      }))
      writeSkill(skill, "after-change")
      await expect(waitForUpdated(events)).resolves.toMatchObject({ type: "commands.updated" })
    } finally {
      await session.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 30_000)
})
