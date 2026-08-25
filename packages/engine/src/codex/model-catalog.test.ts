import { describe, expect, it, vi } from "vitest"
import { modelSelection, readModelCatalog } from "./model-catalog.js"

describe("Codex 模型目录", () => {
  it("逐页读取、过滤隐藏/空 id，并保留第一条重复模型", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({
        data: [
          { id: "a", displayName: "A", hidden: false, inputModalities: ["text"] },
          { id: "secret", hidden: true },
        ],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({
        data: [{ id: "a", displayName: "重复" }, { id: "b", inputModalities: ["text", "image"] }, {}],
        nextCursor: null,
      })
    const models = await readModelCatalog(call)
    expect(call).toHaveBeenNthCalledWith(2, "model/list", { limit: 100, cursor: "next" })
    expect(models.map((model) => model.id)).toEqual(["a", "b"])
    expect(models[1]?.inputModalities).toEqual(["text", "image"])
  })

  it("坏游标重复时停止，不无限请求", async () => {
    const call = vi.fn().mockResolvedValue({ data: [], nextCursor: "same" })
    await readModelCatalog(call)
    expect(call).toHaveBeenCalledTimes(2)
  })

  it("已知模型清掉非法残留；目录尚未回包时保留用户明确请求", () => {
    const options = [{ id: "a", label: "A", efforts: ["low", "high"], defaultEffort: "low" }]
    expect(modelSelection(options, "a", "max")).toEqual({ model: "a", effort: "low" })
    expect(modelSelection(options, "a", "high")).toEqual({ model: "a", effort: "high" })
    expect(modelSelection(options, "unknown", "high")).toEqual({ model: "unknown", effort: "high" })
  })
})
