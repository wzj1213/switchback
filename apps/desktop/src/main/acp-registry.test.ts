import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createAcpRegistry, REGISTRY_URL } from "./acp-registry.js"

const ONE = { version: "1.0.0", agents: [{ id: "gemini", name: "Gemini CLI", version: "0.61.0", distribution: { npx: { package: "@google/gemini-cli@0.61.0" } } }] }
const TWO = { version: "1.0.0", agents: [...ONE.agents, { id: "goose", name: "goose", version: "1.52.0" }] }
const HOUR = 60 * 60_000

function setup(options: { cached?: { fetchedAt: number; registry: unknown }; reply?: unknown; fail?: string; now?: number }) {
  const dir = mkdtempSync(join(tmpdir(), "switchback-registry-"))
  if (options.cached !== undefined) writeFileSync(join(dir, "acp-registry.json"), JSON.stringify(options.cached), "utf8")
  const asked: string[] = []
  const fetcher = ((url: string) => {
    asked.push(url)
    if (options.fail !== undefined) return Promise.reject(new Error(options.fail))
    return Promise.resolve(new Response(JSON.stringify(options.reply ?? {}), { status: 200 }))
  }) as unknown as typeof fetch
  const registry = createAcpRegistry({
    dir, fetch: fetcher, now: () => options.now ?? 10 * HOUR, log: { file: "", write: () => undefined },
  })
  return { dir, asked, registry }
}

describe("ACP 注册表的取与存", () => {
  it("本机那份不到一小时：不联网", async () => {
    const h = setup({ cached: { fetchedAt: 10 * HOUR - 1000, registry: ONE }, reply: TWO })
    const got = await h.registry.read()
    expect(h.asked).toEqual([])
    expect(got).toMatchObject({ source: "cache", fetchedAt: 10 * HOUR - 1000 })
    expect(got.agents.map((a) => a.id)).toEqual(["gemini"])
  })

  it("过期了就取一次，取到的写回本机", async () => {
    const h = setup({ cached: { fetchedAt: 8 * HOUR, registry: ONE }, reply: TWO })
    const got = await h.registry.read()
    expect(h.asked).toEqual([REGISTRY_URL])
    expect(got).toMatchObject({ source: "network", fetchedAt: 10 * HOUR })
    expect(got.agents.map((a) => a.id)).toEqual(["gemini", "goose"])
    const saved = JSON.parse(readFileSync(join(h.dir, "acp-registry.json"), "utf8")) as { fetchedAt: number }
    expect(saved.fetchedAt).toBe(10 * HOUR)
  })

  it("点「刷新」时哪怕新鲜也取", async () => {
    const h = setup({ cached: { fetchedAt: 10 * HOUR, registry: ONE }, reply: TWO })
    expect((await h.registry.read(true)).source).toBe("network")
  })

  it("离线：给本机那份，并说清取不到、这份有多旧", async () => {
    const h = setup({ cached: { fetchedAt: 2 * HOUR, registry: ONE }, fail: "getaddrinfo ENOTFOUND" })
    const got = await h.registry.read()
    expect(got).toMatchObject({ source: "cache", fetchedAt: 2 * HOUR })
    expect(got.error).toContain("ENOTFOUND")
    expect(got.error).toContain("本机存的那份")
    expect(got.agents).toHaveLength(1)
  })

  it("离线又从没取到过：空清单 + 下一步", async () => {
    const h = setup({ fail: "The operation was aborted due to timeout" })
    const got = await h.registry.read()
    expect(got).toMatchObject({ source: "none", agents: [] })
    expect(got.error).toContain("15 秒内没取到")
    expect(got.error).toContain("刷新")
  })

  it("取回来一家都认不出：不拿它盖掉本机那份", async () => {
    const h = setup({ cached: { fetchedAt: 1, registry: ONE }, reply: { agents: [] } })
    await h.registry.read()
    const saved = JSON.parse(readFileSync(join(h.dir, "acp-registry.json"), "utf8")) as { fetchedAt: number }
    expect(saved.fetchedAt).toBe(1)
  })
})
