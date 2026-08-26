import { describe, expect, it } from "vitest"
import { baseName, dirHint, outside } from "./file-row.js"

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
