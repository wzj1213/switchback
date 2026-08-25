import { describe, expect, it } from "vitest"
import { currentModel, modelAcceptsImages } from "./model-options.js"

const models = [
  { id: "text", label: "Text", inputModalities: ["text"] as const },
  { id: "vision", label: "Vision", inputModalities: ["text", "image"] as const, isDefault: true },
  { id: "legacy", label: "Legacy" },
]

describe("模型输入模态", () => {
  it("选中项、引擎默认与首项的退路一致", () => {
    expect(currentModel(models, "text")?.id).toBe("text")
    expect(currentModel(models, "missing")?.id).toBe("vision")
  })

  it("明确 text-only 才禁图片，支持 image 或旧目录缺席时都放行", () => {
    expect(modelAcceptsImages(models, "text")).toBe(false)
    expect(modelAcceptsImages(models, "vision")).toBe(true)
    expect(modelAcceptsImages(models, "legacy")).toBe(true)
  })
})
