import { describe, expect, it } from "vitest"
import type { GitState } from "../shared/git.js"
import { actionsOf, blockedOf, summaryOf } from "./commit-bar.js"

const state = (patch: Partial<GitState> = {}): GitState => ({
  repo: true, branch: "main", staged: 0, unstaged: 0, untracked: 0, conflicted: 0, ...patch,
})

describe("summaryOf", () => {
  const table: readonly [Partial<GitState>, string][] = [
    [{}, "main · 工作区干净"],
    [{ staged: 2, unstaged: 3, untracked: 1 }, "main · 已暂存 2 · 未暂存 3 · 新文件 1"],
    [{ unstaged: 1, conflicted: 2 }, "main · 未暂存 1 · 冲突 2"],
    [{ ahead: 2, behind: 1, staged: 1 }, "main（领先 2、落后 1） · 已暂存 1"],
    [{ branch: undefined, detached: true, unstaged: 1 }, "游离 HEAD · 未暂存 1"],
    [{ branch: undefined }, "（还没有分支） · 工作区干净"],
    [{ failed: true }, "main · 这一次没读到 Git 状态"],
  ]
  for (const [patch, want] of table) it(want, () => expect(summaryOf(state(patch))).toBe(want))
})

describe("actionsOf", () => {
  it("什么都没暂存：主按钮就是全部提交", () => {
    expect(actionsOf(state({ unstaged: 2, untracked: 1 }))).toEqual({ primary: { all: true, label: "全部提交（3）" } })
  })
  it("有暂存也有没暂存的：主按钮只提交暂存的，旁边给全部", () => {
    expect(actionsOf(state({ staged: 2, unstaged: 1 }))).toEqual({
      primary: { all: false, label: "提交已暂存的 2 个" },
      secondary: { all: true, label: "全部提交（3）" },
    })
  })
  it("全都暂存了：只有一颗", () => {
    expect(actionsOf(state({ staged: 2 }))).toEqual({ primary: { all: false, label: "提交已暂存的 2 个" } })
  })
})

describe("blockedOf：点不了必须说为什么", () => {
  const dirty = state({ unstaged: 1 })
  const table: readonly [GitState, boolean, string, string | undefined][] = [
    [dirty, true, "x", "这条会话还在跑：等它停下再提交，免得提交到改了一半的文件"],
    [state({ unstaged: 1, conflicted: 1 }), false, "x", "有 1 个合并冲突没解决"],
    [state(), false, "x", "没有可提交的改动"],
    [dirty, false, "  \n", "先写一句提交说明"],
    [state({ failed: true, unstaged: 1 }), false, "x", "这一次没读到 Git 状态，点「重读」再试"],
    [dirty, false, "修一下", undefined],
  ]
  for (const [git, running, message, want] of table) {
    it(String(want), () => expect(blockedOf(git, running, message)).toBe(want))
  }
})
