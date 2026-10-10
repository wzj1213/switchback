import { describe, expect, it } from "vitest"
import { promptContent } from "./attach.js"

const SHOT = "/Users/me/Library/Application Support/Switchback/attachments/shot.png"

describe("Kimi 附件交路径", () => {
  const cases: readonly { name: string; text: string; attachments?: readonly string[]; want: unknown }[] = [
    { name: "只有文字", text: "看看", want: [{ type: "text", text: "看看" }] },
    {
      name: "文字在前、图片按原顺序跟上",
      text: "看图",
      attachments: [SHOT, "/tmp/b.jpg"],
      want: [
        { type: "text", text: "看图" },
        { type: "image", source: { kind: "path", path: SHOT } },
        { type: "image", source: { kind: "path", path: "/tmp/b.jpg" } },
      ],
    },
    { name: "只发图片也合法", text: "", attachments: [SHOT], want: [{ type: "image", source: { kind: "path", path: SHOT } }] },
  ]
  for (const one of cases) {
    it(one.name, () => {
      expect(promptContent(one.text, one.attachments)).toEqual(one.want)
    })
  }

  it("不读图片内容：请求体只带路径，大图也不会撞上 kimi web 的 1 MiB 上限", () => {
    // 路径不存在也照样生成：读盘、核对与压缩都是 Kimi 自己的事
    const body = JSON.stringify({ content: promptContent("看图", ["/definitely/missing/huge.png"]) })
    expect(body.length).toBeLessThan(200)
  })

  it("什么都没有就明确拒绝", () => {
    expect(() => promptContent("", [])).toThrow("Kimi 的提示内容不能为空")
  })
})
