import { describe, expect, it } from "vitest"
import type { ContextMenuParams } from "electron"
import { contextItems } from "./context-menu.js"

const paramsWith = (over: Partial<ContextMenuParams>): ContextMenuParams =>
  ({
    linkURL: "",
    selectionText: "",
    isEditable: false,
    editFlags: { canCut: false, canCopy: false, canPaste: false },
    ...over,
  }) as ContextMenuParams

const labels = (params: ContextMenuParams): readonly string[] =>
  contextItems(params, "zh-CN").map((item) => item.label ?? item.type ?? "?")

describe("右键菜单给哪几项", () => {
  it("选中了文字就给复制——这是「选中一段话拿不走」的唯一出路", () => {
    expect(labels(paramsWith({ selectionText: "抽出来了" }))).toEqual(["复制"])
    // 全是空白的选中当没有
    expect(labels(paramsWith({ selectionText: "  \n " }))).toEqual([])
  })

  it("输入框里给整套编辑动作，能不能点照 editFlags 走", () => {
    const items = contextItems(paramsWith({
      isEditable: true,
      editFlags: { canCut: true, canCopy: true, canPaste: false } as ContextMenuParams["editFlags"],
    }), "zh-CN")
    expect(items.map((i) => i.label ?? i.type)).toEqual(["剪切", "复制", "粘贴", "separator", "全选"])
    // 剪贴板是空的时候摆一个能点的「粘贴」是骗人
    expect(items.find((i) => i.label === "粘贴")?.enabled).toBe(false)
    expect(items.find((i) => i.label === "剪切")?.enabled).toBe(true)
  })

  it("英文界面用 macOS 的英文菜单说法", () => {
    expect(contextItems(paramsWith({ linkURL: "https://example.com/a", selectionText: "看这里" }), "en")
      .map((item) => item.label ?? item.type)).toEqual(["Copy Link Address", "separator", "Copy"])
  })

  it("落在链接上多给一条复制链接地址", () => {
    expect(labels(paramsWith({ linkURL: "https://example.com/a" }))).toEqual(["复制链接地址"])
    expect(labels(paramsWith({ linkURL: "https://example.com/a", selectionText: "看这里" })))
      .toEqual(["复制链接地址", "separator", "复制"])
  })

  it("什么都不适用时给空数组——弹一个只有灰项的菜单比不弹更像坏了", () => {
    expect(labels(paramsWith({}))).toEqual([])
  })
})
