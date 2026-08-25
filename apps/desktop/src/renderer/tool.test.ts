import { describe, expect, it } from "vitest"
import { relPath, shellTranscript, summarize } from "./tool.js"

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

describe("工作区里的路径写成相对的", () => {
  it("落在工作区里就只留相对部分", () => {
    expect(relPath("/w/src/a.ts", "/w")).toBe("src/a.ts")
  })

  it("cwd 带不带尾斜杠都一样", () => {
    expect(relPath("/w/src/a.ts", "/w/")).toBe("src/a.ts")
  })

  it("**工作区外的保留绝对形式**——那正是「它伸到项目外面去了」的时刻，缩短它等于把信号抹平", () => {
    expect(relPath("/Users/you/别处.ts", "/w")).toBe("/Users/you/别处.ts")
  })

  it("同前缀但不同目录不算在里面（/w2 不是 /w 的子目录）", () => {
    expect(relPath("/w2/a.ts", "/w")).toBe("/w2/a.ts")
  })

  it("路径就是 cwd 本身时不缩成空字符串", () => {
    expect(relPath("/w", "/w")).toBe("/w")
  })
})

describe("后台终端记录", () => {
  it("把终端输出与后台输入分开，不能把 stdin 冒充成 stdout", () => {
    expect(
      shellTranscript({
        kind: "shell",
        command: "read answer",
        output: "ready\n",
        terminal: { waiting: false, inputs: ["yes\n", "done\n"] },
      }),
    ).toBe("终端输出：\nready\n\n\n后台终端输入 1：\nyes\n\n\n后台终端输入 2：\ndone\n")
  })
})
