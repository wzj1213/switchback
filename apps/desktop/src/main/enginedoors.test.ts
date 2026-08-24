import { describe, expect, it } from "vitest"
import { editableEngineDoorPaths, engineDoors } from "./enginedoors.js"

/**
 * 这一页只回答一个问题：**各家自己的设置在哪个文件里。**
 *
 * 所以要钉住的也只有三件：路径对不对、项目级那几份在没有工作区时不该出现、
 * 以及家目录跟不跟环境变量走（改过家目录的人正是最需要这一页的）。
 */
describe("各家自己的设置在哪儿", () => {
  it("**没有工作区时不列项目级的那几份**——那时它们无处可指", async () => {
    const doors = await engineDoors(undefined)
    expect(doors.every((d) => d.scope !== "project")).toBe(true)
    // 五家的用户级配置都要在
    expect([...new Set(doors.map((d) => d.id))].sort()).toEqual([
      "claude",
      "codex",
      "dsh",
      "grok",
      "kimi",
    ])
  })

  it("有工作区时补上项目级的那几份，路径落在工作区里", async () => {
    const doors = await engineDoors("/w")
    const project = doors.filter((d) => d.scope === "project")
    expect(project.length).toBeGreaterThan(0)
    expect(project.every((d) => d.path.startsWith("/w/"))).toBe(true)
  })

  it("**家目录跟着各家自己的环境变量走**，不写死 `~/.x`", async () => {
    const before = process.env["CODEX_HOME"]
    process.env["CODEX_HOME"] = "/tmp/codex-elsewhere"
    try {
      const doors = await engineDoors(undefined)
      expect(doors.find((d) => d.id === "codex" && d.scope === "user")?.path).toBe(
        "/tmp/codex-elsewhere/config.toml",
      )
    } finally {
      if (before === undefined) delete process.env["CODEX_HOME"]
      else process.env["CODEX_HOME"] = before
    }
  })

  it("DSH 的设置与 ACP profile 都跟着 DSH_HOME", async () => {
    const before = process.env["DSH_HOME"]
    process.env["DSH_HOME"] = "/tmp/dsh-elsewhere"
    try {
      const paths = (await engineDoors(undefined))
        .filter((door) => door.id === "dsh")
        .map((door) => door.path)
      expect(paths).toEqual([
        "/tmp/dsh-elsewhere/settings.yaml",
        "/tmp/dsh-elsewhere/profiles/acp/cordis.patch.yml",
      ])
    } finally {
      if (before === undefined) delete process.env["DSH_HOME"]
      else process.env["DSH_HOME"] = before
    }
  })

  it("DSH profile 配置门跟着当前选择，不写死 acp", async () => {
    const path = (await engineDoors(undefined, "team"))
      .find((door) => door.id === "dsh" && door.path.endsWith("cordis.patch.yml"))?.path
    expect(path).toContain("/profiles/team/cordis.patch.yml")
  })

  it("**读不到就当不存在**，这一页不该因为权限或路径怪异整个空掉", async () => {
    const doors = await engineDoors("/一个不存在的目录")
    expect(doors.every((d) => typeof d.exists === "boolean")).toBe(true)
  })

  it("grok 的厂商维护那份要标出来——它不该被手改", async () => {
    const doors = await engineDoors(undefined)
    expect(doors.some((d) => d.id === "grok" && d.scope === "managed")).toBe(true)
  })

  it("系统编辑器 allowlist 排除不存在与厂商维护的文件", () => {
    expect(
      editableEngineDoorPaths([
        { id: "a", label: "A", scope: "user", path: "/user", exists: true, note: "" },
        { id: "a", label: "A", scope: "project", path: "/missing", exists: false, note: "" },
        { id: "a", label: "A", scope: "managed", path: "/managed", exists: true, note: "" },
      ]),
    ).toEqual(["/user"])
  })
})
