import { describe, expect, it } from "vitest"
import { attachmentWarning, nothingToSend } from "./composer-state.js"

describe("输入区发送状态", () => {
  it.each([
    ["没有图片", { attachments: 0, canAttach: true, pending: false, aside: true }, undefined],
    ["侧问不收图片", { attachments: 1, canAttach: true, pending: false, aside: true },
      "侧问不支持图片附件；图片已保留，请移除或退出侧问后再发"],
    ["侧问原因优先于待切换", { attachments: 1, canAttach: true, pending: true, aside: true },
      "侧问不支持图片附件；图片已保留，请移除或退出侧问后再发"],
    ["待切换引擎", { attachments: 1, canAttach: true, pending: true, aside: false },
      "请先完成引擎切换，再确认新引擎能否接收这些附件；附件会保留"],
    ["当前引擎不支持", { attachments: 1, canAttach: false, pending: false, aside: false },
      "当前引擎或模型不支持图片附件；附件已保留，请移除或切换后再发"],
    ["普通图片可发送", { attachments: 1, canAttach: true, pending: false, aside: false }, undefined],
  ] as const)("%s", (_name, state, expected) => {
    expect(attachmentWarning(state)).toBe(expected)
  })

  it("附件被挡住时发送键禁用，即使还有正文", () => {
    expect(nothingToSend({
      attachmentBlocked: true,
      text: "这张图怎么了",
      hasCommand: false,
      attachments: 1,
    })).toBe(true)
  })
})
