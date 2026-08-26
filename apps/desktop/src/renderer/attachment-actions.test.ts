import { describe, expect, it } from "vitest"
import { droppedImages, pasteImages, pickedImages } from "./attachment-actions.js"

function image(name: string, type = "image/png", size = 10): File {
  return { name, type, size, arrayBuffer: async () => new ArrayBuffer(size) } as File
}

const bridge = {
  pathForFile: (file: File): string => `/tmp/${file.name}`,
  stashImage: async (mime: string): Promise<string> => `/saved/${mime.slice(6)}.png`,
  pickImages: async () => ({ paths: ["/picked/a.png"], rejected: 0, canceled: false }),
}

describe("附件三种入口", () => {
  it("拖入时保留图片并说清被拒绝的普通文件", () => {
    const files = [image("a.png"), image("code.ts", "text/typescript")] as unknown as FileList
    expect(droppedImages(files, true, bridge)).toEqual({
      paths: ["/tmp/a.png"],
      notice: "已添加 1 张；另有 1 个文件未添加。",
    })
  })

  it("拖入源码时不把文件类型错报成模型能力", () => {
    const files = [image("code.ts", "text/typescript")] as unknown as FileList
    expect(droppedImages(files, false, bridge)).toEqual({
      paths: [],
      notice: "未添加：这里只接收图片；工作区文件请用 @ 引用。",
    })
  })

  it("粘贴图片异步落盘，普通文本文件不进入上下文", async () => {
    const items = [image("a.png"), image("notes.txt", "text/plain")].map((file) => ({
      kind: "file", getAsFile: () => file,
    })) as unknown as DataTransferItemList
    expect(await pasteImages(items, true, bridge)).toEqual({
      paths: ["/saved/png.png"],
      notice: "已添加 1 张；另有 1 个文件未添加。",
    })
  })

  it("系统选择器取消时不制造提示", async () => {
    const canceled = { ...bridge, pickImages: async () => ({ paths: [], rejected: 0, canceled: true }) }
    expect(await pickedImages(canceled)).toEqual({ paths: [] })
  })
})
