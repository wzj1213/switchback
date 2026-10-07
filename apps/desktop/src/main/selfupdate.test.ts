import { execFile } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { bundleOf, freshBundleOf, swapScript } from "./selfupdate.js"

describe("认出自己装在哪儿", () => {
  it("从 .app 里跑的，取到包根", () => {
    expect(bundleOf("/Applications/Switchback.app/Contents/MacOS/Switchback")).toBe("/Applications/Switchback.app")
  })

  it("开发模式（electron 二进制）不是包，返回 undefined", () => {
    expect(bundleOf("/Users/w/work/switchback/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")).toBe(
      "/Users/w/work/switchback/node_modules/electron/dist/Electron.app",
    )
    expect(bundleOf("/usr/local/bin/node")).toBeUndefined()
  })

  it("路径里带空格照样认", () => {
    expect(bundleOf("/Users/w/我的 应用/Switchback.app/Contents/MacOS/Switchback")).toBe("/Users/w/我的 应用/Switchback.app")
  })
})

/**
 * 换包脚本是这件事里**唯一没法回滚的一步**：它在应用已经退出之后跑，
 * 出错时没有任何界面能报错。所以它的三条保命规矩要钉死。
 */
describe("换包脚本", () => {
  const script = swapScript({ pid: 4242, from: "/repo/release/mac-arm64/Switchback.app", to: "/Applications/Switchback.app", log: "/tmp/u.log" })

  it("先等旧进程退出——覆盖一个正在跑的 .app 会让它当场崩", () => {
    expect(script).toContain("kill -0 4242")
    // 而且不能无限等：等不到要退出，不能悄悄挂在那儿
    expect(script).toContain('[ "$n" -gt 300 ]')
  })

  it("**同目录 mv**，不原地覆盖——同盘 mv 是原子的，断电也不会留下换了一半的应用", () => {
    expect(script).toContain("/Applications/Switchback.app.更新中")
    expect(script).toContain("mv '/Applications/Switchback.app' '/Applications/Switchback.app.上一版'")
  })

  it("**装新的失败就把旧的挪回来**——一次失败的更新可以接受，应用没了不行", () => {
    expect(script).toMatch(/mv '\/Applications\/Switchback\.app\.更新中' '\/Applications\/Switchback\.app' \|\| \{ mv '\/Applications\/Switchback\.app\.上一版' '\/Applications\/Switchback\.app'/)
  })

  it("换完自己开回来", () => {
    expect(script.trimEnd().split("\n").at(-2)).toContain("open '/Applications/Switchback.app'")
  })

  it("路径里的单引号不会把脚本劈开", () => {
    const nasty = swapScript({ pid: 1, from: "/a/it's here.app", to: "/b/Switchback.app", log: "/tmp/l" })
    expect(nasty).toContain(`'/a/it'\\''s here.app'`)
  })

  /**
   * **真跑一遍。** 这一步在应用退出之后才执行，出了错没有任何界面报得了错——
   * 只断言脚本的字面内容等于「读了一遍自己写的字」，那不叫验证。
   */
  it("真跑一遍：装着的那份被换成新的", async () => {
    const dir = mkdtempSync(join(tmpdir(), "switchback-swap-"))
    const from = bundle(dir, "新.app", "新")
    const to = bundle(dir, "装着的.app", "旧")
    // 用一个不存在的 pid：那圈「等旧进程退出」立刻就过
    const script = swapScript({ pid: 2_147_483_647, from, to, log: join(dir, "log") })
      // 别真把东西打开——这里验的是换包，不是 `open`
      .replace(`open '${to}'`, "true")
    const file = join(dir, "swap.sh")
    writeFileSync(file, script, { mode: 0o755 })
    await promisify(execFile)("/bin/sh", [file])
    expect(readFileSync(join(to, "Contents", "who"), "utf8")).toBe("新")
  })
})

/** 一个假的 .app：只要有个能读出来的记号，够验换没换就行。 */
function bundle(dir: string, name: string, who: string): string {
  const path = join(dir, name)
  mkdirSync(join(path, "Contents"), { recursive: true })
  writeFileSync(join(path, "Contents", "who"), who)
  return path
}

describe("新包叫什么：按仓库里当前的产品名找", () => {
  const cases: readonly [string, string | undefined, string][] = [
    ["读到 productName 就用它", JSON.stringify({ productName: "Switchback" }), "Switchback.app"],
    ["改了名也跟着走（旧版本照样找得到新包）", JSON.stringify({ productName: "Renamed" }), "Renamed.app"],
    ["读不到就按默认名", undefined, "Switchback.app"],
    ["不是 JSON 也按默认名", "{", "Switchback.app"],
  ]
  for (const [name, pkg, expected] of cases) {
    it(name, () => {
      const repo = mkdtempSync(join(tmpdir(), "selfupdate-repo-"))
      try {
        if (pkg !== undefined) {
          mkdirSync(join(repo, "apps/desktop"), { recursive: true })
          writeFileSync(join(repo, "apps/desktop/package.json"), pkg)
        }
        expect(freshBundleOf(repo)).toBe(join(repo, "release/mac-arm64", expected))
      } finally {
        rmSync(repo, { recursive: true, force: true })
      }
    })
  }
})
