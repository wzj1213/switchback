import { describe, expect, it } from "vitest"
import { skillsToCommands } from "./catalog.js"

describe("scope：这条技能是哪儿来的", () => {
  it("`user` / `system` 照搬——界面把它画在最右边（codex 自己也这么画）", () => {
    const raw = { data: [{ skills: [{ name: "a", scope: "user" }, { name: "b", scope: "system" }] }] }
    expect(skillsToCommands(raw).map((c) => c.scope)).toEqual(["user", "system"])
  })

  it("**没见过的值一律丢掉**，不照抄成字符串——界面按枚举画标签，混进去只会画出个乱码角标", () => {
    const raw = { data: [{ skills: [{ name: "a", scope: "从未见过的档次" }] }] }
    expect(skillsToCommands(raw)[0]?.scope).toBeUndefined()
  })
})

describe("displayName 当名字用，不再拼进说明", () => {
  it("有中文名就当 label——codex 面板左边一列就是它，人扫那列是在找**那件事**", () => {
    const raw = {
      data: [
        {
          skills: [
            { name: "berth-adopt", description: "长长的触发条件…", interface: { displayName: "berth 收编", shortDescription: "注册进 berth" } },
          ],
        },
      ],
    }
    expect(skillsToCommands(raw)[0]).toMatchObject({
      name: "berth-adopt",
      label: "berth 收编",
      description: "注册进 berth",
    })
  })

  it("没有中文名就不给 label，界面退回显示 `/name`", () => {
    const raw = { data: [{ skills: [{ name: "api-post", description: "用本机 API Post…" }] }] }
    expect(skillsToCommands(raw)[0]?.label).toBeUndefined()
  })

  it("displayName 和 name 一样时也不给——画两遍同一个词是噪声", () => {
    const raw = { data: [{ skills: [{ name: "deck", interface: { displayName: "deck" } }] }] }
    expect(skillsToCommands(raw)[0]?.label).toBeUndefined()
  })
})
