import { describe, expect, it } from "vitest"
import { summarize } from "./tool.js"

describe("工具活动折成一句话", () => {
  it("**按首次出现去重**——连着读五个文件不该写五遍「读取了文件」", () => {
    expect(summarize(["file_read", "file_read", "file_read"])).toBe("读取了文件")
  })

  it("顺序保留：它就是它做事的顺序", () => {
    expect(summarize(["file_edit", "file_read", "shell"])).toBe("编辑了文件 · 读取了文件 · 运行了命令")
  })

  it("重复出现的种类只在第一次的位置上算一次", () => {
    expect(summarize(["shell", "file_edit", "shell"])).toBe("运行了命令 · 编辑了文件")
  })

  it("空列表给空串，不给一个孤零零的分隔符", () => {
    expect(summarize([])).toBe("")
  })
})
