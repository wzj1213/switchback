import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { createCodexDriver } from "./driver.js"

async function waitForWarning(events: readonly Event[]): Promise<Event> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const warning = events.find(
      (event) => event.type === "engine.status" && event.detail?.includes(".codex") === true,
    )
    if (warning !== undefined) return warning
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`5 秒内没有收到配置警告；实际事件：${JSON.stringify(events)}`)
}

async function waitForDeprecation(events: readonly Event[]): Promise<Event> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const warning = events.find(
      (event) => event.type === "engine.status" && event.detail?.includes("web_search_request") === true,
    )
    if (warning !== undefined) return warning
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`5 秒内没有收到弃用提示；实际事件：${JSON.stringify(events)}`)
}

/**
 * 真起 Codex，验证开场配置警告穿过 app-server 与驱动：
 * `pnpm vitest run --mode live packages/engine/src/codex/warnings.live.test.ts`
 */
describe("Codex 配置警告（真机）", () => {
  it("未受信任的项目配置会留下可定位的会话提示", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "switchback-codex-warning-live-"))
    const projectConfig = join(cwd, ".codex")
    mkdirSync(join(cwd, ".git"))
    mkdirSync(projectConfig)
    writeFileSync(join(projectConfig, "config.toml"), "")
    const events: Event[] = []
    const driver = createCodexDriver()
    const session = await driver.start({
      threadId: "live-codex-warning",
      cwd,
      trust: "read-only",
      home: homedir(),
      memory: () => [],
      emit: (event) => events.push(event),
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      const warning = await waitForWarning(events)
      expect(warning).toMatchObject({ type: "engine.status", status: "degraded" })
      expect(warning?.type === "engine.status" ? warning.detail : "").toContain("disabled")
    } finally {
      await session.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 30_000)

  it("旧配置开关会留下原生迁移说明", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "switchback-codex-deprecation-live-"))
    mkdirSync(join(cwd, ".git"))
    const events: Event[] = []
    const driver = createCodexDriver({
      args: ["app-server", "--stdio", "-c", "features.web_search_request=true"],
    })
    const session = await driver.start({
      threadId: "live-codex-deprecation",
      cwd,
      trust: "read-only",
      home: homedir(),
      memory: () => [],
      emit: (event) => events.push(event),
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      const warning = await waitForDeprecation(events)
      expect(warning).toMatchObject({ type: "engine.status", status: "degraded" })
      expect(warning?.type === "engine.status" ? warning.detail : "").toContain("web_search")
    } finally {
      await session.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 30_000)
})
