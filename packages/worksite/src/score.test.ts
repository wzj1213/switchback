import { describe, expect, it } from "vitest"
import { rank, score } from "./score.js"
import { SKIP_DIRS } from "./index.js"

describe("score", () => {
  it("匹配不上给 undefined", () => {
    expect(score("src/host.ts", "zzz")).toBeUndefined()
  })

  it("空查询给 0，让 `@` 一按就能列点东西出来", () => {
    expect(score("anything", "")).toBe(0)
  })

  it("不区分大小写", () => {
    expect(score("src/Host.ts", "host")).toBeDefined()
  })

  it("子序列就算命中——不必连续", () => {
    expect(score("packages/host/src/gate.ts", "phg")).toBeDefined()
  })
})

describe("rank", () => {
  const pick = (paths: readonly string[], q: string): readonly string[] =>
    rank(paths, q, 10).map((h) => h.path)

  it("**文件名比目录名重要**——这是路径排序里最重要的一条", () => {
    const [first] = pick(["packages/host/src/gate.ts", "src/host.ts"], "host")
    expect(first).toBe("src/host.ts")
  })

  it("连续命中胜过分散命中", () => {
    const [first] = pick(["a/h-o-s-t.ts", "a/host.ts"], "host")
    expect(first).toBe("a/host.ts")
  })

  it("词首命中胜过词中命中", () => {
    const [first] = pick(["src/ghost.ts", "src/host.ts"], "host")
    expect(first).toBe("src/host.ts")
  })

  it("同样匹配时短路径优先", () => {
    const [first] = pick(["a/b/c/d/e/host.ts", "host.ts"], "host")
    expect(first).toBe("host.ts")
  })

  it("结果稳定：分数相同按字典序，同一次查询两次结果一样", () => {
    const paths = ["b/x.ts", "a/x.ts"]
    expect(pick(paths, "x.ts")).toEqual(pick(paths, "x.ts"))
  })

  it("limit 生效", () => {
    const paths = Array.from({ length: 50 }, (_, i) => `src/file${String(i)}.ts`)
    expect(rank(paths, "file", 5)).toHaveLength(5)
  })

  it("匹配不上的一个都不返回", () => {
    expect(rank(["a.ts", "b.ts"], "zzz", 10)).toEqual([])
  })

  it("**贪心咬住目录里的第一个匹配就再也回不了头**——补一趟只看文件名的匹配", () => {
    // 真实仓库里跑出来的：两者都在目录段 `host/` 上匹配完了，
    // 于是只剩路径长度在比，README 更短就赢了
    const [first] = pick(["packages/host/README.md", "packages/host/src/host.ts"], "host")
    expect(first).toBe("packages/host/src/host.ts")
  })

  it("文件名里多出来的字符要扣分：`host.ts` 排在 `host.test.ts` 前面", () => {
    const paths = ["packages/host/src/host.live.test.ts", "packages/host/src/host.test.ts", "packages/host/src/host.ts"]
    expect(pick(paths, "host")[0]).toBe("packages/host/src/host.ts")
  })

  it("只在目录里匹配得上的仍然算命中，只是排在后面", () => {
    expect(pick(["packages/host/README.md"], "host")).toEqual(["packages/host/README.md"])
  })

  it("扩展名也能搜——`.tsx` 找得到组件", () => {
    const [first] = pick(["src/App.tsx", "src/app.ts"], ".tsx")
    expect(first).toBe("src/App.tsx")
  })
})

describe("构建产物不该进索引", () => {
  it("**`release` 也要排除**——electron-builder 的默认输出，omni 自己就用它", () => {
    expect(SKIP_DIRS.has("release")).toBe(true)
  })

  it("常见的构建/依赖目录都在表里", () => {
    for (const dir of ["node_modules", ".git", "dist", "build", "out", "release", "target", "coverage", "vendor"]) {
      expect(SKIP_DIRS.has(dir)).toBe(true)
    }
  })

  it("`src` 这种当然不能排除", () => {
    expect(SKIP_DIRS.has("src")).toBe(false)
    expect(SKIP_DIRS.has("packages")).toBe(false)
  })
})
