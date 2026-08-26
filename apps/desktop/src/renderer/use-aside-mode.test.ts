import { describe, expect, it } from "vitest"
import { asideQuestion } from "./use-aside-mode.js"

describe("侧问快捷键发送判定", () => {
  it.each([
    ["正常正文", { can: true, handler: true, text: "  问一句  ", hasCommand: false, blocked: false }, "问一句"],
    ["附件被挡", { can: true, handler: true, text: "问一句", hasCommand: false, blocked: true }, undefined],
    ["能力缺失", { can: false, handler: true, text: "问一句", hasCommand: false, blocked: false }, undefined],
    ["没有处理器", { can: true, handler: false, text: "问一句", hasCommand: false, blocked: false }, undefined],
    ["已有命令", { can: true, handler: true, text: "问一句", hasCommand: true, blocked: false }, undefined],
    ["空正文", { can: true, handler: true, text: "  ", hasCommand: false, blocked: false }, undefined],
  ] as const)("%s", (_name, state, expected) => {
    expect(asideQuestion(state)).toBe(expected)
  })
})
