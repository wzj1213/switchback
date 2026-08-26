import { describe, expect, it } from "vitest"
import { baseName, dirHint, fileRowDestination, outside } from "./file-row.js"

describe("文件行的名字与目录", () => {
  const cwd = "/work/repos"
  const cases: readonly { path: string; name: string; hint: string; out: boolean }[] = [
    // 工作区里的深目录：只留末两级，前缀省成一个点
    {
      path: `${cwd}/order-service/src/main/java/com/example/shop/service/OrderBatchService.java`,
      name: "OrderBatchService.java",
      hint: "…/shop/service",
      out: false,
    },
    { path: `${cwd}/README.md`, name: "README.md", hint: "", out: false },
    { path: `${cwd}/src/app.ts`, name: "app.ts", hint: "src", out: false },
    // 工作区搜索给的是相对路径；Windows 下分隔符也可能是反斜杠
    { path: "apps/desktop/src/main.ts", name: "main.ts", hint: "…/desktop/src", out: false },
    { path: "apps\\desktop\\src\\main.ts", name: "main.ts", hint: "…/desktop/src", out: false },
    // 工作区外：目录同样收成末两级，完整路径留给 title
    {
      path: "/Users/me/.codex/skills/doc-manage/SKILL.md",
      name: "SKILL.md",
      hint: "…/skills/doc-manage",
      out: true,
    },
    { path: "/tmp/draft_prd.md", name: "draft_prd.md", hint: "/tmp", out: true },
    // 前缀相同但不是同一个目录，不能算在工作区里
    { path: "/work/repos-old/a.ts", name: "a.ts", hint: "/work/repos-old", out: true },
  ]

  for (const item of cases) {
    it(`${item.path} → ${item.name}${item.hint === "" ? "" : ` · ${item.hint}`}`, () => {
      expect(baseName(item.path)).toBe(item.name)
      expect(dirHint(item.path, cwd)).toBe(item.hint)
      expect(outside(item.path, cwd)).toBe(item.out)
    })
  }
})

describe("文件行键盘移动", () => {
  const cases: readonly [key: string, at: number, total: number, expected: number | "search" | undefined][] = [
    ["ArrowDown", 0, 4, 1],
    ["ArrowDown", 3, 4, 3],
    ["ArrowUp", 2, 4, 1],
    ["ArrowUp", 0, 4, "search"],
    ["Home", 2, 4, 0],
    ["End", 1, 4, 3],
    ["Enter", 1, 4, undefined],
    ["ArrowDown", 0, 0, undefined],
  ]

  for (const [key, at, total, expected] of cases) {
    it(`${key} · ${String(at + 1)}/${String(total)} → ${String(expected)}`, () => {
      expect(fileRowDestination(key, at, total)).toBe(expected)
    })
  }
})
