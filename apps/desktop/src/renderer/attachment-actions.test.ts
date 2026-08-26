import { describe, expect, it } from "vitest"
import { droppedFiles, pasteFiles, pickedFiles } from "./attachment-actions.js"

function image(name: string, type = "image/png", size = 10): File {
  return { name, type, size, arrayBuffer: async () => new ArrayBuffer(size) } as File
}

const bridge = {
  pathForFile: (file: File): string => `/tmp/${file.name}`,
  stashImage: async (mime: string): Promise<string> => `/saved/${mime.slice(6)}.png`,
  pickFiles: async () => ({ files: [
    { path: "/picked/a.png", image: true },
    { path: "/picked/code.ts", image: false },
  ], failed: 0, canceled: false }),
}

describe("附件三种入口", () => {
  it("拖入时图片走附件、普通文件写成工作区引用", () => {
    const files = [image("a.png"), image("code.ts", "text/typescript")] as unknown as FileList
    expect(droppedFiles(files, true, bridge, "/tmp")).toEqual({
      paths: ["/tmp/a.png"],
      references: ["code.ts"],
      notice: { text: "已添加 1 张图片，并引用 1 个文件。", tone: "info" },
    })
  })

  it("模型不支持图片不妨碍源码成为可见引用", () => {
    const files = [image("code.ts", "text/typescript")] as unknown as FileList
    expect(droppedFiles(files, false, bridge, "/tmp")).toEqual({
      paths: [],
      references: ["code.ts"],
      notice: { text: "已引用 1 个文件。", tone: "info" },
    })
  })

  it("图片附件关闭时，拖入的图片也保留为可见引用", () => {
    const files = [image("a.png")] as unknown as FileList
    expect(droppedFiles(files, false, bridge, "/tmp")).toEqual({
      paths: [],
      references: ["a.png"],
      notice: { text: "已引用 1 个文件。", tone: "info" },
    })
  })

  it("粘贴图片异步落盘，普通文件同时进入可编辑正文", async () => {
    const items = [image("a.png"), image("notes.txt", "text/plain")].map((file) => ({
      kind: "file", getAsFile: () => file,
    })) as unknown as DataTransferItemList
    expect(await pasteFiles(items, true, bridge, "/tmp")).toEqual({
      paths: ["/saved/png.png"],
      references: ["notes.txt"],
      notice: { text: "已添加 1 张图片，并引用 1 个文件。", tone: "info" },
    })
  })

  it("剪贴板图片连字节都读不到时回退为路径引用", async () => {
    const broken = {
      ...image("broken.png"),
      arrayBuffer: async () => { throw new Error("read failed") },
    } as File
    const items = [{ kind: "file", getAsFile: () => broken }] as unknown as DataTransferItemList
    expect(await pasteFiles(items, true, bridge, "/tmp")).toEqual({
      paths: [],
      references: ["broken.png"],
      notice: { text: "已引用 1 个文件。", tone: "info" },
    })
  })

  it("工作区外文件保留绝对路径并提示引擎权限", () => {
    const files = [image("spec.pdf", "application/pdf")] as unknown as FileList
    expect(droppedFiles(files, true, bridge, "/work/omni")).toEqual({
      paths: [],
      references: ["/tmp/spec.pdf"],
      notice: {
        text: "已引用 1 个文件。其中 1 个在当前工作区外，已保留绝对路径；能否读取由引擎权限决定。",
        tone: "warn",
      },
    })
  })

  it("系统选择器与拖入走同一套图片附件和文件引用分流", async () => {
    expect(await pickedFiles(bridge, true, "/picked")).toEqual({
      paths: ["/picked/a.png"],
      references: ["code.ts"],
      notice: { text: "已添加 1 张图片，并引用 1 个文件。", tone: "info" },
    })
  })

  it("模型不支持图片时，选择的图片也保留为可见引用", async () => {
    expect(await pickedFiles(bridge, false, "/picked")).toEqual({
      paths: [],
      references: ["a.png", "code.ts"],
      notice: { text: "已引用 2 个文件。", tone: "info" },
    })
  })

  it("系统选择器取消时不制造提示", async () => {
    const canceled = { ...bridge, pickFiles: async () => ({ files: [], failed: 0, canceled: true }) }
    expect(await pickedFiles(canceled, true, "/picked")).toEqual({ paths: [], references: [] })
  })
})
