import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readDshProfiles } from "./dsh-profiles.js"

function profile(home: string, name: string, manifest: unknown, patch = false): void {
  const dir = join(home, "profiles", name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest), "utf8")
  if (patch) writeFileSync(join(dir, "cordis.patch.yml"), "plugins: []\n", "utf8")
}

describe("DSH profile 清单", () => {
  it("保留 bundle 顺序、直接依赖版本与 patch 状态", async () => {
    const home = mkdtempSync(join(tmpdir(), "omni-dsh-profiles-"))
    profile(home, "acp", {
      dependencies: { "@deepseek-ai/dsh-acp": "rc.6", "community-adapter": "1.2.3" },
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "community-adapter"] } },
    }, true)
    profile(home, "web", { dependencies: {}, dsh: { profile: { bundles: ["base", "web"] } } })

    const catalog = await readDshProfiles(home)
    expect(catalog.profiles.map((item) => item.name)).toEqual(["acp", "web"])
    expect(catalog.profiles[0]).toMatchObject({
      valid: true,
      patchExists: true,
      bundles: ["@deepseek-ai/dsh-base", "community-adapter"],
      dependencies: [
        { name: "@deepseek-ai/dsh-acp", version: "rc.6" },
        { name: "community-adapter", version: "1.2.3" },
      ],
    })
  })

  it("坏 manifest 留在清单里并标不可用，profiles/node_modules 不冒充 profile", async () => {
    const home = mkdtempSync(join(tmpdir(), "omni-dsh-profiles-"))
    const broken = join(home, "profiles", "broken")
    mkdirSync(broken, { recursive: true })
    writeFileSync(join(broken, "package.json"), "{", "utf8")
    mkdirSync(join(home, "profiles", "node_modules"), { recursive: true })

    const catalog = await readDshProfiles(home)
    expect(catalog.profiles).toHaveLength(1)
    expect(catalog.profiles[0]).toMatchObject({ name: "broken", valid: false })
    expect(catalog.profiles[0]?.error).toBeDefined()
  })
})
