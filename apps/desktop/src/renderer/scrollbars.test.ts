import { describe, expect, it } from "vitest"
import { barsOf } from "./useScrollbars.js"

/**
 * 「现在是叠加条还是经典条」**只能量，不能问**：CSS 和 JS 都没有这个查询，
 * 而它随时会变（系统设置「自动根据鼠标或触控板」，插上鼠标就切）。
 *
 * 判据本身只有一行，但它决定了整套自绘样式挂不挂——挂错档位的后果是
 * 把触控板用户白送的叠加条（0px、自动淡出）换成一根常驻的条。
 */
describe("滚动条是哪一档", () => {
  it("占宽度 = 经典条：这时候才轮到我们自绘", () => {
    expect(barsOf(15)).toBe("classic")
    expect(barsOf(17)).toBe("classic")
  })

  it("**不占宽度 = 叠加条：一个字节都不要动**——系统那套本来就是「滚才现、会淡出」", () => {
    expect(barsOf(0)).toBe("overlay")
  })

  it("量出负数（不该发生）也当叠加条：宁可不画，不要画错", () => {
    expect(barsOf(-1)).toBe("overlay")
  })
})
