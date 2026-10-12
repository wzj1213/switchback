import { describe, expect, it } from "vitest"
import { packBytes } from "./bytes.js"

describe("调用参数里的字节", () => {
  const cases: readonly { label: string; arg: unknown; expected: unknown }[] = [
    {
      label: "ArrayBuffer 编成 base64",
      arg: { mime: "image/png", bytes: new TextEncoder().encode("png!").buffer },
      expected: { mime: "image/png", bytes: { $bytes: btoa("png!") } },
    },
    {
      label: "TypedArray 只取它自己那一段，不是整个底层 buffer",
      arg: { bytes: new Uint8Array([0, 1, 2, 3, 4]).subarray(1, 3) },
      expected: { bytes: { $bytes: btoa(String.fromCharCode(1, 2)) } },
    },
    { label: "没有字节的原样", arg: { cwd: "/w", n: 1 }, expected: { cwd: "/w", n: 1 } },
    { label: "标量原样", arg: "x", expected: "x" },
    { label: "undefined 原样", arg: undefined, expected: undefined },
    { label: "数组不展开", arg: [new Uint8Array([1])], expected: [new Uint8Array([1])] },
  ]
  for (const one of cases) {
    it(one.label, () => {
      expect(packBytes(one.arg)).toEqual(one.expected)
    })
  }

  it("**大图也编得出来**——一口气展开会撑爆调用栈", () => {
    const big = new Uint8Array(5 * 1024 * 1024).fill(7)
    const packed = packBytes({ bytes: big }) as { bytes: { $bytes: string } }
    expect(atob(packed.bytes.$bytes).length).toBe(big.length)
  })
})
