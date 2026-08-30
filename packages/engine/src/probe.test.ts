import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { isWindows } from "./platform.js"
import { probeCommand, resolveCommand } from "./probe.js"

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
  // `cmd` 收到 `--version` 会报错退出。
  //
  // **这条以前断言 missing，那是错的**：文件就在 PATH 上，`which` 找得到它。
  // 报「未安装」会让人去装第二遍，而装多少遍都不会变（坏壳排在前面）。
  // 「装了」和「能用」确实是两回事——所以它们该是两个状态，不是同一个。
  it("在 PATH 上但 `--version` 跑不起来 → unavailable，**不是「未安装」：文件就在那儿**", async () => {
    const probe = await probeCommand(isWindows ? "cmd" : "false")
    expect(probe.state).toBe("unavailable")
    expect(probe.detail).toContain("跑不起来")
  })

  it("没给提示时不硬凑一句废话", async () => {
    const probe = await probeCommand("omni-绝不存在的命令")
    expect(probe.detail.trim().endsWith("不在 PATH 上。")).toBe(true)
  })
})

/**
 * **PATH 上第一个同名文件坏掉的时候，不能就此判「没装」。**
 *
 * 真机上遇到的：`~/.vendor-cli/vendor-cli/bin/codex` 排在 homebrew 前面，
 * 而那个文件已经不在了（第三方 CLI 自更新留下的空壳目录），
 * 于是 omni 报「codex 未安装」，而 `/opt/homebrew/bin/codex` 好好的。
 * 用户看到的是「codex 读错地方了」。
 *
 * 这里把那个故障原样造出来：**自己搭一个假的 PATH**，前面放坏的、后面放好的。
 */
describe.skipIf(isWindows)("PATH 上有好几个同名的", () => {
  /** 造一个目录，里面放一个叫 `omni-探测靶子` 的可执行文件。 */
  function bin(script: string): string {
    const dir = mkdtempSync(join(tmpdir(), "omni-probe-"))
    const file = join(dir, TARGET)
    writeFileSync(file, script)
    chmodSync(file, 0o755)
    return dir
  }

  const TARGET = "omni-探测靶子"
  const GOOD = "#!/bin/sh\necho '靶子 9.9.9'\n"
  /** 坏成两种样子：跑起来就失败，以及**根本不是可执行文件**（空壳）。 */
  const BROKEN = "#!/bin/sh\nexit 1\n"

  const withPath = async <T>(dirs: readonly string[], fn: () => Promise<T>): Promise<T> => {
    const saved = process.env["PATH"] ?? ""
    process.env["PATH"] = [...dirs, saved].join(":")
    try {
      return await fn()
    } finally {
      process.env["PATH"] = saved
    }
  }

  it("第一个坏、后面有好的 → 用好的那个，state 是 ok", async () => {
    const broken = bin(BROKEN)
    const good = bin(GOOD)
    const probe = await withPath([broken, good], () => probeCommand(TARGET))
    expect(probe.state).toBe("ok")
    expect(probe.path).toBe(join(good, TARGET))
    expect(probe.detail).toContain("靶子 9.9.9")
  })

  it("**spawn 要用的也是那个好的路径**——不然探测说好、真跑的是另一个", async () => {
    const broken = bin(BROKEN)
    const good = bin(GOOD)
    const resolved = await withPath([broken, good], () => resolveCommand(TARGET))
    expect(resolved).toBe(join(good, TARGET))
  })

  it("全都坏 → unavailable，而且**把试过几个说出来**", async () => {
    const a = bin(BROKEN)
    const b = bin(BROKEN)
    const probe = await withPath([a, b], () => probeCommand(TARGET, "去设置里重装一遍。"))
    expect(probe.state).toBe("unavailable")
    expect(probe.detail).toContain("2 个同名文件")
    // **坏的多半是排在最前面那个**——不说这句，用户会对着后面那份完好的反复重装
    expect(probe.detail).toContain("靠前的那个先被用到")
    // 契约：missing / unavailable 都必须说得出下一步。这一支以前欠着
    expect(probe.detail).toContain("去设置里重装一遍。")
    expect(probe.path).toBeUndefined()
  })

  // 解析不出来就原样返回，让 spawn 去报 ENOENT——那条错误比我们编的准
  it("一个都跑不起来时，resolveCommand 原样返回", async () => {
    const resolved = await withPath([bin(BROKEN)], () => resolveCommand(TARGET))
    expect(resolved).toBe(TARGET)
  })
})

// 实测 zcode-acp-server：`--version` 退出码 0 但什么都不打。
// 硬接一个破折号的话，下拉里是 `/opt/homebrew/bin/x — `，看起来像出了错
it("跑得起来但不报版本 → 只显示路径，不留一个空破折号", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-probe-"))
  const file = join(dir, "omni-哑靶子")
  writeFileSync(file, "#!/bin/sh\nexit 0\n")
  chmodSync(file, 0o755)
  const saved = process.env["PATH"] ?? ""
  process.env["PATH"] = `${dir}:${saved}`
  try {
    const probe = await probeCommand("omni-哑靶子")
    expect(probe.state).toBe("ok")
    expect(probe.detail).toBe(file)
  } finally {
    process.env["PATH"] = saved
  }
})
