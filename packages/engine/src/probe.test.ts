import { describe, expect, it } from "vitest"
import { isWindows } from "./platform.js"
import { probeCommand } from "./probe.js"

/**
 * **真跑系统的查找命令**，不 mock。mock 掉之后这个测试就只剩
 * 「我写的 if 分支还在」了，而这里要验的恰恰是**和真实系统的交互**——
 * `which` 与 `where.exe` 的行为差别正是它存在的理由。
 *
 * 用到的命令三个平台都有（`node` 由 CI 装、`false` / `cmd` 是系统自带），
 * 所以这个文件在 CI 的三格里都跑。
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

  // Windows 上没有 `false` 这个命令，换一个「一定在 PATH 上但 --version 会失败」的：
  // `cmd` 收到 `--version` 会报错退出。这条验的是「装了」和「能用」是两回事
  it("在 PATH 上但 `--version` 跑不起来 → 也算 missing，**「装了」和「能用」是两回事**", async () => {
    const probe = await probeCommand(isWindows ? "cmd" : "false")
    expect(probe.state).toBe("missing")
    expect(probe.detail).toContain("跑不起来")
  })

  it("没给提示时不硬凑一句废话", async () => {
    const probe = await probeCommand("omni-绝不存在的命令")
    expect(probe.detail.trim().endsWith("不在 PATH 上。")).toBe(true)
  })
})
