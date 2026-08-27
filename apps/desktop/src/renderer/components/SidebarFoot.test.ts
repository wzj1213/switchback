import { describe, expect, it } from "vitest"
import { nameOf } from "./SidebarFoot.js"

/**
 * 侧栏底部那一行显示什么名字。
 *
 * **表驱动**：这几种输入的区别只在一个字符（有没有 `@`、有没有套餐），
 * 一个 case 一个 `it` 的话，读的人得比对六段几乎一样的代码才能看出规律。
 */
describe("nameOf", () => {
  const cases: readonly [string, { label: string; plan?: string }, string][] = [
    ["邮箱只留 @ 前面那一截", { label: "alice@example.com" }, "alice"],
    ["Apple 中继地址同理，域名不是这一行要答的问题",
      { label: "a1b2c3d4e5@privaterelay.appleid.com" }, "a1b2c3d4e5"],
    ["不是邮箱就原样显示", { label: "messi leo" }, "messi leo"],
    ["有套餐就跟在后面——「谁」和「哪一档」是同一个问题的两半",
      { label: "alice@example.com", plan: "Max" }, "alice · Max"],
    ["套餐是空串等于没报", { label: "messi leo", plan: "" }, "messi leo"],
    ["`@` 开头的怪名字不砍：砍完就什么都不剩了", { label: "@ghost" }, "@ghost"],
  ]
  it.each(cases)("%s", (_why, account, expected) => {
    expect(nameOf(account)).toBe(expected)
  })
})
