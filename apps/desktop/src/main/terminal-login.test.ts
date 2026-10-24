import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loginScriptOf, openTerminalLogin, shellQuote } from "./terminal-login.js"

describe("shellQuote", () => {
  const table: readonly string[] = ["plain", "has space", "it's", "$(rm -rf ~)", "`x`", "a\nb", "中文"]
  for (const value of table) {
    it(JSON.stringify(value), () => {
      // 让真的 sh 把它读回来：转义对不对，只有 shell 说了算
      expect(execFileSync("/bin/sh", ["-c", `printf %s ${shellQuote(value)}`], { encoding: "utf8" })).toBe(value)
    })
  }
})

describe("登录脚本", () => {
  const login = {
    label: "Claude Agent",
    command: "/opt/homebrew/bin/npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp@0.81.2", "--cli", "auth", "login", "--claudeai"],
    env: { API_KEY: "it's secret", "BAD-NAME": "x" },
    cwd: "/Users/dev/My Project",
    path: "/opt/homebrew/bin:/usr/bin:/bin",
  }

  it("先删自己，再导出 PATH 与环境（名字不合法的丢掉），参数逐个转义", () => {
    const script = loginScriptOf(login)
    const lines = script.split("\n")
    expect(lines[0]).toBe("#!/bin/sh")
    expect(lines[1]).toBe('rm -f -- "$0"')
    expect(script).toContain("export PATH='/opt/homebrew/bin:/usr/bin:/bin'")
    expect(script).toContain("export API_KEY='it'\\''s secret'")
    expect(script).not.toContain("BAD-NAME")
    expect(script).toContain("cd '/Users/dev/My Project' || exit 1")
    expect(script).toContain("'/opt/homebrew/bin/npx' '-y' '@agentclientprotocol/claude-agent-acp@0.81.2' '--cli' 'auth' 'login' '--claudeai'")
  })

  it("英文界面下提示说英文；退出码那句仍交给 shell 展开 $code", () => {
    const script = loginScriptOf(login, "en")
    // 撇号照 shellQuote 的规矩转义过：`'` → `'\\''`
    expect(script).toContain("'Switchback: what follows is Claude Agent'\\''s own sign-in flow.")
    expect(script).toContain('else echo "The sign-in flow exited with code $code."; fi')
    expect(execFileSync("/bin/sh", ["-c", 'code=3; echo "The sign-in flow exited with code $code."'], { encoding: "utf8" }))
      .toBe("The sign-in flow exited with code 3.\n")
  })

  it("真的跑一遍：命令拿到的参数与环境一字不差，跑完脚本已经不在盘上", async () => {
    const dir = mkdtempSync(join(tmpdir(), "switchback-login-"))
    const out = join(dir, "seen.txt")
    const probe = join(dir, "probe.sh")
    writeFileSync(probe, `#!/bin/sh\nprintf '%s|' "$@" > ${shellQuote(out)}\nprintf '%s' "$API_KEY" >> ${shellQuote(out)}\n`, { mode: 0o755 })
    const opened: string[] = []
    const error = await openTerminalLogin(join(dir, "login"), { ...login, command: probe, args: ["a b", "it's"], cwd: dir }, (path) => {
      opened.push(path)
      execFileSync("/bin/sh", [path])
      return Promise.resolve("")
    })
    expect(error).toBeUndefined()
    expect(execFileSync("cat", [out], { encoding: "utf8" })).toBe("a b|it's|it's secret")
    expect(existsSync(opened[0] ?? "")).toBe(false)
  })

  it("系统打不开就照实说", async () => {
    const dir = mkdtempSync(join(tmpdir(), "switchback-login-"))
    const error = await openTerminalLogin(dir, login, () => Promise.resolve("No application knows how to open"))
    expect(error).toContain("没能打开「终端」")
  })
})
