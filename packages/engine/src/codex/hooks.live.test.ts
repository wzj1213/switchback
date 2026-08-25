import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { EngineSession } from "../contract.js"
import type { Event } from "@omni/protocol"
import { resolveCommand } from "../probe.js"
import { createRpc } from "../rpc.js"
import { createProcessOwner } from "../subprocess.js"
import { createCodexDriver } from "./driver.js"

async function withCodexHome<T>(home: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env["CODEX_HOME"]
  process.env["CODEX_HOME"] = home
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env["CODEX_HOME"]
    else process.env["CODEX_HOME"] = previous
  }
}

async function waitForHook(events: readonly Event[]): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const denied = events.some(
      (event) => (event.type === "item.started" || event.type === "item.updated")
        && event.item.kind === "tool_call"
        && event.item.status === "denied",
    )
    const settled = events.some((event) => event.type === "turn.completed")
    if (denied && settled) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`10 秒内 hook 没有阻断并收工：${JSON.stringify(events)}`)
}

function writeBlockingHook(home: string): void {
  const script = join(home, "block-hook.mjs")
  writeFileSync(script, [
    "await new Promise((resolve) => setTimeout(resolve, 450))",
    "process.stdout.write(JSON.stringify({ decision: 'block', reason: 'OMNI_HOOK_BLOCK' }))",
  ].join("\n"))
  writeFileSync(join(home, "config.toml"), [
    "[features]",
    "hooks = true",
    "[hooks]",
    "[[hooks.UserPromptSubmit]]",
    "[[hooks.UserPromptSubmit.hooks]]",
    'type = "command"',
    `command = ${JSON.stringify(`${process.execPath} ${script}`)}`,
    'statusMessage = "OMNI_HOOK_RUNNING"',
  ].join("\n"))
}

interface ListedHook {
  key?: string
  currentHash?: string
}

/** 走 Codex 自己的清单与配置写入接口，模拟用户在原生界面确认过这个 hook。 */
async function trustHook(home: string, cwd: string): Promise<void> {
  const owner = createProcessOwner({ exitGraceMs: 1000, termGraceMs: 1000 })
  const child = owner.spawn({
    command: await resolveCommand("codex"),
    args: ["app-server", "--stdio"],
    cwd,
    env: { ...process.env, CODEX_HOME: home },
  })
  const rpc = createRpc({
    send: (line) => child.stdin?.write(`${line}\n`),
    onNotification: () => undefined,
    onRequest: (call) => call.respond({}),
  })
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => rpc.feed(chunk))
  child.stderr?.resume()
  try {
    await rpc.call("initialize", {
      clientInfo: { name: "omni-hook-live", title: "omni hook live", version: "0" },
      capabilities: {},
    })
    rpc.notify("initialized")
    const listed = await rpc.call("hooks/list", { cwds: [cwd] }) as {
      data?: readonly { hooks?: readonly ListedHook[] }[]
    }
    const hook = listed.data?.[0]?.hooks?.[0]
    if (hook?.key === undefined || hook.currentHash === undefined) {
      throw new Error(`Codex 没发现测试 hook：${JSON.stringify(listed)}`)
    }
    await rpc.call("config/batchWrite", {
      edits: [{
        keyPath: "hooks.state",
        value: { [hook.key]: { trusted_hash: hook.currentHash } },
        mergeStrategy: "upsert",
      }],
      reloadUserConfig: false,
    })
  } finally {
    rpc.close("hook 信任准备完成")
    child.stdin?.end()
    await owner.reclaim()
  }
}

/**
 * 真起 Codex，让用户级 hook 拦下 prompt：
 * `pnpm vitest run --mode live packages/engine/src/codex/hooks.live.test.ts`
 */
describe.sequential("Codex hook（真机）", () => {
  it("慢 hook 会显示运行态，拦截理由留在原轮次", async () => {
    const root = mkdtempSync(join(tmpdir(), "omni-codex-hook-live-"))
    const home = join(root, "codex-home")
    const cwd = join(root, "work")
    mkdirSync(home)
    mkdirSync(cwd)
    mkdirSync(join(cwd, ".git"))
    writeBlockingHook(home)
    await trustHook(home, cwd)
    const events: Event[] = []
    let session: EngineSession | undefined
    try {
      session = await withCodexHome(home, () => createCodexDriver({
        args: ["app-server", "--stdio"],
      }).start({
        threadId: "live-codex-hook",
        cwd,
        trust: "read-only",
        home,
        memory: () => [],
        emit: (event) => events.push(event),
        askUser: () => Promise.resolve({ allow: false, remember: "once" }),
        askQuestion: () => Promise.resolve({ dismissed: true }),
      }))
      await session.prompt("SHOULD_NOT_REACH_MODEL", "turn-hook")
      await waitForHook(events)
      expect(events).toContainEqual(expect.objectContaining({
        type: "item.started",
        item: expect.objectContaining({ status: "running", tool: "hook/userPromptSubmit" }),
      }))
      expect(events).toContainEqual(expect.objectContaining({
        type: "item.updated",
        item: expect.objectContaining({ status: "denied", error: "feedback: OMNI_HOOK_BLOCK" }),
      }))
    } finally {
      await session?.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})
