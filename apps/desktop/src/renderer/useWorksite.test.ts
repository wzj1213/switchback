import { describe, expect, it } from "vitest"
import { branchLabel, dirtyMark } from "./useWorksite.js"

/**
 * 只测这个纯函数。hook 本身（焦点重问、换 cwd 清值、切走之后回来的响应不写界面）
 * 走人工验收——仓库里没有 jsdom，而给这一个 hook 引一整套 DOM 测试环境，
 * 代价和收益不成比例。
 */
describe("分支芯片上显示什么", () => {
  it("在分支上就是分支名", () => {
    expect(branchLabel({ branch: "main" })).toBe("main")
  })

  // 这条是重点：`rev-parse --abbrev-ref HEAD` 在游离时回字面量 `HEAD`，
  // 直接显示就成了「一个叫 HEAD 的分支」——一个不存在的东西
  it("游离时是「游离 · <短 sha>」，不是一个叫 HEAD 的分支", () => {
    expect(branchLabel({ branch: "b31ccdd", detached: true })).toBe("游离 · b31ccdd")
  })

  it("不是 git 仓库就不显示这枚芯片", () => {
    expect(branchLabel({})).toBeUndefined()
  })

  // 换工作区时 hook 会先清空成 `{}`，那一刻 branch 是空串还是缺席都要不显示——
  // 否则芯片会闪成一个只有图标没有文字的空壳
  it("空串也当没有", () => {
    expect(branchLabel({ branch: "" })).toBeUndefined()
  })
})

describe("芯片上跟在分支后面那一小截", () => {
  it("说数量，不只说「有」——三个和三百个，该不该让引擎接着动手是两个答案", () => {
    expect(dirtyMark({ dirtyCount: 3 })).toBe(" · 3")
  })

  it("干净就什么都不加", () => {
    expect(dirtyMark({ dirtyCount: 0 })).toBe("")
  })

  // 一个没 gitignore 的 node_modules 能让这个数上万，五位数会把分支名挤出去
  it("截到 999+", () => {
    expect(dirtyMark({ dirtyCount: 1000 })).toBe(" · 999+")
    expect(dirtyMark({ dirtyCount: 999 })).toBe(" · 999")
  })

  // 老的桌面主进程不报这个字段（远程端连着旧机器时会遇到）——那时退回原来那个点，
  // 而不是把「脏」这件事整个丢掉
  it("没有计数就退回一个点，不把「脏」丢掉", () => {
    expect(dirtyMark({ dirty: true })).toBe(" ·")
    expect(dirtyMark({ dirty: false })).toBe("")
  })
})
