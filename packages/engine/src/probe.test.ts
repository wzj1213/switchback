import { describe, expect, it } from "vitest"
import { probeCommand } from "./probe.js"

/**
 * 真跑 `which`。这几个命令在任何 POSIX 机器上都有，不需要装什么，
 * 也不需要 mock——mock 掉 `which` 之后这个测试就只剩「我写的 if 分支还在」了，
 * 而这里真正要验的恰恰是**和真实系统的交互**。
 */
describe("探命令", () => {
  it("PATH 上有、`--version` 也跑得起来 → ok，并带上路径", async () => {
    const probe = await probeCommand("node")
    expect(probe.state).toBe("ok")
    expect(probe.detail).toMatch(/node/)
  })

  it("**没装就要说得出下一步做什么**——一句「不可用」等于什么都没说", async () => {
    const probe = await probeCommand("omni-绝不存在的命令", "装好之后重启 omni。")
    expect(probe.state).toBe("missing")
    expect(probe.detail).toContain("不在 PATH 上")
    expect(probe.detail).toContain("装好之后重启 omni。")
  })

  it("在 PATH 上但 `--version` 跑不起来 → 也算 missing，**「装了」和「能用」是两回事**", async () => {
    // `false` 一定存在，而且不管给什么参数都以非 0 退出
    const probe = await probeCommand("false")
    expect(probe.state).toBe("missing")
    expect(probe.detail).toContain("跑不起来")
  })

  it("没给提示时不硬凑一句废话", async () => {
    const probe = await probeCommand("omni-绝不存在的命令")
    expect(probe.detail.trim().endsWith("不在 PATH 上。")).toBe(true)
  })
})
