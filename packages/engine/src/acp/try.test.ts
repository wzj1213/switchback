import { describe, expect, it } from "vitest"
import { tryAcp } from "./try.js"
import { tmpdir } from "node:os"

/**
 * 用一个**真的子进程**测，不打桩。
 *
 * 这条链路的价值全在「隔着 stdio 和一个陌生程序对话」上——把 spawn 打掉之后
 * 剩下的只是一个 Promise.race，测它等于什么都没测。假 agent 是一行 node 脚本，
 * 没有网络、没有依赖，跑起来是毫秒级。
 */
const AGENT = `
let buf = ""
process.stdin.on("data", (d) => {
  buf += d
  for (const line of buf.split("\\n").slice(0, -1)) {
    const req = JSON.parse(line)
    if (req.method !== "initialize") continue
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: req.id,
      result: { protocolVersion: 1, agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, audio: false },
        sessionCapabilities: { list: {}, fork: {} },
      } },
    }) + "\\n")
  }
  buf = buf.slice(buf.lastIndexOf("\\n") + 1)
})
`

const MUTE = `process.stdin.resume()`

describe("试接一个 ACP 适配器", () => {
  it("答得上 initialize → ok，**能力照它自报的原样列**", async () => {
    const trial = await tryAcp({ command: process.execPath, args: ["-e", AGENT], cwd: tmpdir() })
    expect(trial.ok).toBe(true)
    expect(trial.protocolVersion).toBe(1)
    /*
     * **必须往里再走一层。** 只列顶层的话，kimi 那种会被折成
     * `loadSession / promptCapabilities / sessionCapabilities` 三个词，
     * 而真正有用的 fork / list 全丢在里面了。
     *
     * 两种语义分开：`sessionCapabilities` 是「存在即支持」（空对象当标记），
     * `promptCapabilities` 是实打实的布尔——所以 `audio: false` 不能跟着列出来，
     * 那是「明确说了不支持」。
     */
    expect(trial.capabilities).toEqual(["loadSession", "prompt:image", "session/list", "session/fork"])
  })

  it("命令根本不存在 → 说得出下一步，而不是一句 ENOENT", async () => {
    const trial = await tryAcp({ command: "omni-绝不存在的适配器", cwd: tmpdir() })
    expect(trial.ok).toBe(false)
    expect(trial.error).toContain("找不到可执行文件")
  })

  it("起来了但立刻退 → 报的是它的死因，不是干等到超时", async () => {
    const trial = await tryAcp({
      command: process.execPath,
      args: ["-e", "process.exit(3)"],
      cwd: tmpdir(),
      timeoutMs: 5000,
    })
    expect(trial.ok).toBe(false)
    expect(trial.error).toBeDefined()
  })

  it("活着但一声不吭 → 超时那句要说出「可能要换一组参数」", async () => {
    const trial = await tryAcp({
      command: process.execPath,
      args: ["-e", MUTE],
      cwd: tmpdir(),
      timeoutMs: 300,
    })
    expect(trial.ok).toBe(false)
    expect(trial.error).toContain("没有回应")
    // **这句是关键**：不讲 ACP 和「参数不对」在现象上一模一样，得把后一种可能说出来
    expect(trial.error).toContain("参数")
  })

  it("stderr 不吞掉——失败时那常常是唯一的线索", async () => {
    const trial = await tryAcp({
      command: process.execPath,
      args: ["-e", `console.error("需要先 login"); process.exit(1)`],
      cwd: tmpdir(),
      timeoutMs: 5000,
    })
    expect(trial.ok).toBe(false)
    expect(trial.stderr).toContain("需要先 login")
  })
})
