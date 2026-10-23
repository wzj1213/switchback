import { describe, expect, it } from "vitest"
import { droppedFiles, pasteFiles, pickedFiles } from "./attachment-actions.js"
import { attachmentAcceptance, withoutExistingAttachments } from "./useAttachments.js"

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
  it("只有真正加入附件或正文的 drop 才算接收成功", () => {
    expect(attachmentAcceptance({ paths: [], references: [] })).toEqual({
      references: [], accepted: false,
    })
    expect(attachmentAcceptance({ paths: ["/tmp/a.png"], references: [] })).toEqual({
      references: [], accepted: true,
    })
    expect(attachmentAcceptance({ paths: [], references: ["a.ts"] })).toEqual({
      references: ["a.ts"], accepted: true,
    })
    expect(attachmentAcceptance({
      paths: [], references: [], notice: { text: "读取失败", tone: "warn" },
    })).toEqual({
      references: [], accepted: false, notice: { text: "读取失败", tone: "warn" },
    })
  })

  it("拖入时图片走附件、普通文件写成工作区引用", () => {
    const files = [image("a.png"), image("code.ts", "text/typescript")] as unknown as FileList
    expect(droppedFiles(files, { enabled: true, bridge, cwd: "/tmp", locale: "zh-CN" })).toEqual({
      paths: ["/tmp/a.png"],
      references: ["code.ts"],
      summary: { images: 1, references: 1, failed: 0, outside: 0, duplicates: 0 },
      outsideReferences: [],
      notice: { text: "已添加 1 张图片，并引用 1 个文件。", tone: "info" },
    })
  })

  it("模型不支持图片不妨碍源码成为可见引用", () => {
    const files = [image("code.ts", "text/typescript")] as unknown as FileList
    expect(droppedFiles(files, { enabled: false, bridge, cwd: "/tmp", locale: "zh-CN" })).toEqual({
      paths: [],
      references: ["code.ts"],
      summary: { images: 0, references: 1, failed: 0, outside: 0, duplicates: 0 },
      outsideReferences: [],
      notice: { text: "已引用 1 个文件。", tone: "info" },
    })
  })

  it("图片附件关闭时，拖入的图片也保留为可见引用", () => {
    const files = [image("a.png")] as unknown as FileList
    expect(droppedFiles(files, { enabled: false, bridge, cwd: "/tmp", locale: "zh-CN" })).toEqual({
      paths: [],
      references: ["a.png"],
      summary: { images: 0, references: 1, failed: 0, outside: 0, duplicates: 0 },
      outsideReferences: [],
      notice: { text: "已引用 1 个文件。", tone: "info" },
    })
  })

  it("粘贴图片异步落盘，普通文件同时进入可编辑正文", async () => {
    const items = [image("a.png"), image("notes.txt", "text/plain")].map((file) => ({
      kind: "file", getAsFile: () => file,
    })) as unknown as DataTransferItemList
    expect(await pasteFiles(items, { enabled: true, bridge, cwd: "/tmp", locale: "zh-CN" })).toEqual({
      paths: ["/saved/png.png"],
      references: ["notes.txt"],
      summary: { images: 1, references: 1, failed: 0, outside: 0, duplicates: 0 },
      outsideReferences: [],
      notice: { text: "已添加 1 张图片，并引用 1 个文件。", tone: "info" },
    })
  })

  it("剪贴板图片连字节都读不到时回退为路径引用", async () => {
    const broken = {
      ...image("broken.png"),
      arrayBuffer: async () => { throw new Error("read failed") },
    } as File
    const items = [{ kind: "file", getAsFile: () => broken }] as unknown as DataTransferItemList
    expect(await pasteFiles(items, { enabled: true, bridge, cwd: "/tmp", locale: "zh-CN" })).toEqual({
      paths: [],
      references: ["broken.png"],
      summary: { images: 0, references: 1, failed: 0, outside: 0, duplicates: 0 },
      outsideReferences: [],
      notice: { text: "已引用 1 个文件。", tone: "info" },
    })
  })

  it("剪贴板里的截图超过上限：照实说太大，不说「未能读取」", async () => {
    const huge = image("shot.png", "image/png", 13 * 1024 * 1024)
    const items = [{ kind: "file", getAsFile: () => huge }] as unknown as DataTransferItemList
    const clipboard = { ...bridge, pathForFile: (): string => "" }
    expect(await pasteFiles(items, { enabled: true, bridge: clipboard, cwd: "/tmp", locale: "zh-CN" })).toMatchObject({
      paths: [],
      references: [],
      notice: { text: "未添加：1 张图片超过 12 MB。", tone: "warn" },
    })
  })

  it("工作区外文件保留绝对路径并提示引擎权限", () => {
    const files = [image("spec.pdf", "application/pdf")] as unknown as FileList
    expect(droppedFiles(files, { enabled: true, bridge, cwd: "/work/switchback", locale: "zh-CN" })).toEqual({
      paths: [],
      references: ["/tmp/spec.pdf"],
      summary: { images: 0, references: 1, failed: 0, outside: 1, duplicates: 0 },
      outsideReferences: ["/tmp/spec.pdf"],
      notice: {
        text: "已引用 1 个文件。其中 1 个在当前工作区外，已保留绝对路径；能否读取由引擎权限决定。",
        tone: "warn",
      },
    })
  })

  it("系统选择器与拖入走同一套图片附件和文件引用分流", async () => {
    expect(await pickedFiles({ enabled: true, bridge, cwd: "/picked", locale: "zh-CN" })).toEqual({
      paths: ["/picked/a.png"],
      references: ["code.ts"],
      summary: { images: 1, references: 1, failed: 0, outside: 0, duplicates: 0 },
      outsideReferences: [],
      notice: { text: "已添加 1 张图片，并引用 1 个文件。", tone: "info" },
    })
  })

  it("模型不支持图片时，选择的图片也保留为可见引用", async () => {
    expect(await pickedFiles({ enabled: false, bridge, cwd: "/picked", locale: "zh-CN" })).toEqual({
      paths: [],
      references: ["a.png", "code.ts"],
      summary: { images: 0, references: 2, failed: 0, outside: 0, duplicates: 0 },
      outsideReferences: [],
      notice: { text: "已引用 2 个文件。", tone: "info" },
    })
  })

  it("系统选择器取消时不制造提示", async () => {
    const canceled = { ...bridge, pickFiles: async () => ({ files: [], failed: 0, canceled: true }) }
    expect(await pickedFiles({ enabled: true, bridge: canceled, cwd: "/picked", locale: "zh-CN" })).toEqual({ paths: [], references: [] })
  })

  it("同批重复图片在生成通知前只计一次", () => {
    const files = [image("a.png"), image("a.png")] as unknown as FileList
    expect(droppedFiles(files, { enabled: true, bridge, cwd: "/tmp", locale: "zh-CN" })).toMatchObject({
      paths: ["/tmp/a.png"],
      summary: { images: 1, references: 0, failed: 0, outside: 0, duplicates: 1 },
      notice: {
        text: "已添加 1 张图片；另有 1 个文件已经在待发送内容中，没有重复添加。",
        tone: "info",
      },
    })
  })

  it("再次拖入正文与附件已有文件时不制造假成功", () => {
    const files = [image("a.png"), image("code.ts", "text/typescript")] as unknown as FileList
    const result = withoutExistingAttachments(
      droppedFiles(files, { enabled: true, bridge, cwd: "/tmp", locale: "zh-CN" }),
      new Set(["/tmp/a.png"]),
      "检查 @code.ts ",
      "zh-CN",
    )
    expect(result).toMatchObject({
      paths: [], references: [],
      summary: { images: 0, references: 0, failed: 0, outside: 0, duplicates: 2 },
      notice: { text: "没有重复添加：2 个文件已经在待发送内容中。", tone: "info" },
    })
    expect(attachmentAcceptance(result).accepted).toBe(false)
  })
})
