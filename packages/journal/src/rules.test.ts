import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createRuleStore, keyOf, type StoredRule } from "./rules.js"

const rule = (id: string): StoredRule => ({
  id,
  describe: `自动允许 ${id}`,
  pattern: { commandSignature: id },
  scope: "project",
})

describe("keyOf", () => {
  it("同一个路径永远同一个文件名", () => {
    expect(keyOf("/a/b/c")).toBe(keyOf("/a/b/c"))
  })

  it("不同路径不撞——哪怕末段目录名一样", () => {
    expect(keyOf("/one/work")).not.toBe(keyOf("/two/work"))
  })

  it("带中文和空格的路径也生成得出合法文件名", () => {
    expect(keyOf("/Users/我的 项目/foo")).toMatch(/^[A-Za-z0-9._-]+\.json$/)
  })

  it("末段全是非法字符时不产出裸下划线开头的怪名字", () => {
    expect(keyOf("/项目")).toMatch(/^ws-[0-9a-f]{16}\.json$/)
  })
})

describe("createRuleStore", () => {
  const state = { dir: "" }

  beforeEach(async () => {
    state.dir = await mkdtemp(join(tmpdir(), "switchback-rules-"))
  })
  afterEach(async () => {
    await rm(state.dir, { recursive: true, force: true })
  })

  it("加了能读出来", async () => {
    const store = createRuleStore(join(state.dir, "rules"))
    await store.add("/w", rule("pnpm test"))
    expect(await store.read("/w")).toHaveLength(1)
  })

  it("按工作区分开——一个项目的规则不该跑到另一个项目上", async () => {
    const store = createRuleStore(state.dir)
    await store.add("/one", rule("a"))
    expect(await store.read("/two")).toEqual([])
  })

  it("同 id 覆盖而不是堆两条", async () => {
    const store = createRuleStore(state.dir)
    await store.add("/w", rule("a"))
    await store.add("/w", { ...rule("a"), describe: "改过的描述" })
    const all = await store.read("/w")
    expect(all).toHaveLength(1)
    expect(all[0]?.describe).toBe("改过的描述")
  })

  it("同一工作区并发追加不会互相覆盖", async () => {
    const store = createRuleStore(state.dir)
    await Promise.all(Array.from({ length: 30 }, (_, index) => store.add("/w", rule(`r-${String(index)}`))))
    expect(await store.read("/w")).toHaveLength(30)
  })

  it("同一工作区的增删按调用顺序串行落定", async () => {
    const store = createRuleStore(state.dir)
    await store.add("/w", rule("a"))
    await Promise.all([store.add("/w", rule("b")), store.remove("/w", "a"), store.add("/w", rule("c"))])
    expect((await store.read("/w")).map((item) => item.id)).toEqual(["b", "c"])
  })

  it("remove 只删指定那条", async () => {
    const store = createRuleStore(state.dir)
    await store.add("/w", rule("a"))
    await store.add("/w", rule("b"))
    expect(await store.remove("/w", "a")).toHaveLength(1)
  })

  it("没有规则文件时读出空数组", async () => {
    expect(await createRuleStore(state.dir).read("/never")).toEqual([])
  })

  it("文件坏了当成没有规则——**不能当成「全部允许」**，也不该让会话起不来", async () => {
    const store = createRuleStore(state.dir)
    await writeFile(join(state.dir, keyOf("/w")), "{ 这不是 JSON")
    expect(await store.read("/w")).toEqual([])
  })

  it("文件里混进不成形的条目时只丢那几条", async () => {
    const store = createRuleStore(state.dir)
    await writeFile(join(state.dir, keyOf("/w")), JSON.stringify([rule("a"), { nope: 1 }]))
    expect(await store.read("/w")).toHaveLength(1)
  })

  it("拒绝空匹配和非 project 规则，不能把坏文件变成全局放行", async () => {
    const store = createRuleStore(state.dir)
    await writeFile(join(state.dir, keyOf("/w")), JSON.stringify([
      rule("safe"),
      { id: "wildcard", describe: "危险空规则", pattern: {}, scope: "project" },
      { ...rule("session"), scope: "session" },
      { id: "unknown", describe: "旧客户端看不懂", pattern: { future: "x" }, scope: "project" },
    ]))
    expect(await store.read("/w")).toEqual([rule("safe")])
  })

  it("写出来的是给人读的 JSON——排查时要能直接打开看", async () => {
    const store = createRuleStore(state.dir)
    await store.add("/w", rule("a"))
    const text = await readFile(join(state.dir, keyOf("/w")), "utf8")
    expect(text).toContain("\n  ")
  })
})
