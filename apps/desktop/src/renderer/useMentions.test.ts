import { describe, expect, it } from "vitest"
import { queuedMentionPath } from "./useMentions.js"

describe("异步文件引用确认", () => {
  const cases: readonly {
    name: string
    pending: boolean
    loading: boolean
    failed: boolean
    paths: readonly string[]
    expected: string | undefined
  }[] = [
    { name: "还在搜索就继续等", pending: true, loading: true, failed: false, paths: [], expected: undefined },
    { name: "结果到达后承接第一项", pending: true, loading: false, failed: false,
      paths: ["src/app.ts", "src/api.ts"], expected: "src/app.ts" },
    { name: "没有按确认键不自动选择", pending: false, loading: false, failed: false,
      paths: ["src/app.ts"], expected: undefined },
    { name: "搜索失败不自动选择", pending: true, loading: false, failed: true,
      paths: ["stale.ts"], expected: undefined },
  ]

  for (const one of cases) {
    it(one.name, () => {
      expect(queuedMentionPath(one.pending, one)).toBe(one.expected)
    })
  }
})
