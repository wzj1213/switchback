import { describe, expect, it } from "vitest"
import { createEgressMeter, LIMIT_BYTES, observe, recordsOf, type EgressMeter, type Watched } from "./egress-meter.js"
import type { Traffic } from "./egress-sample.js"

const MB = 1024 * 1024

/** claude：组长 200、它起的 MCP 服务 204 算它自己；201 是它跑的一条 `git push`。 */
const CLAUDE: Watched = { key: "pid:200", label: "Claude Code", threads: ["t1"], leader: 200, runtime: [200, 204], tools: [201] }

/** 按秒推进的一串拍子：每一拍给出这一刻每个 pid 的累计外发量（MB）。 */
function run(
  ticks: readonly (readonly [number, Readonly<Record<number, number>>])[],
  watched: readonly Watched[] = [CLAUDE],
  meter: EgressMeter = createEgressMeter(),
): { alerts: number[]; meter: EgressMeter } {
  const alerts: number[] = []
  for (const [second, sent] of ticks) {
    const traffic = new Map<number, Traffic>(Object.entries(sent).map(([pid, mb]) => [Number(pid), { sent: mb * MB, received: 0 }]))
    const living = new Set([...traffic.keys(), 200, 201, 204])
    for (const alert of observe(meter, second * 1000, { watched, traffic, living })) alerts.push(Math.round(alert.bytes / MB))
  }
  return { alerts, meter }
}

describe("一分钟里它自己往外发了多少", () => {
  it("**守卫刚起的那一拍只记底数**：之前跑了几个小时发的五百兆不算这一分钟的", () => {
    expect(run([[0, { 200: 500 }], [3, { 200: 501 }]]).alerts).toEqual([])
  })

  it("整仓打包往外传：一拍多出 80 MB，当场报", () => {
    expect(run([[0, { 200: 1 }], [3, { 200: 81 }]]).alerts).toEqual([80])
  })

  it("正常对话的量（三秒一兆，一分钟二十兆）永远碰不到线", () => {
    const ticks = Array.from({ length: 60 }, (_, i) => [i * 3, { 200: i }] as const)
    expect(run(ticks).alerts).toEqual([])
  })

  it("细水长流也逃不掉：三秒十兆，一分钟里攒过线的那一拍报", () => {
    const ticks = Array.from({ length: 12 }, (_, i) => [i * 3, { 200: i * 10 }] as const)
    // 第 7 拍时窗里是 7 × 10 = 70 MB
    expect(run(ticks).alerts).toEqual([70])
  })

  it("**它跑的命令不拿来判**：模型当着你的面 `git push` 了 200 MB，那是你让它做的事——只记账", () => {
    const { alerts, meter } = run([[0, { 201: 0 }], [3, { 201: 200 }]])
    expect(alerts).toEqual([])
    expect(recordsOf(meter)[0]?.toolSent).toBe(200 * MB)
  })

  it("它起的 MCP 服务算它自己：不经过 shell 的外发一样要判", () => {
    expect(run([[0, { 204: 0 }], [3, { 204: 90 }]]).alerts).toEqual([90])
  })

  it("两拍之间才起来、起来就往外发的新进程：整份都算", () => {
    expect(run([[0, { 200: 0 }], [3, { 200: 0, 204: 100 }]]).alerts).toEqual([100])
  })

  it("跑了很久才进名单的进程（会话刚接上）：只算进名单之后多发的", () => {
    const meter = createEgressMeter()
    run([[0, { 200: 0 }], [3, { 200: 900 }]], [], meter)
    expect(run([[6, { 200: 905 }]], [CLAUDE], meter).alerts).toEqual([])
  })

  it("报过一次，五分钟之内不再报第二次；过了五分钟还在传就再报", () => {
    const ticks = [[0, { 200: 0 }], [3, { 200: 100 }], [6, { 200: 200 }], [400, { 200: 300 }]] as const
    expect(run(ticks).alerts).toEqual([100, 100])
  })

  it("线就是 64 MB", () => {
    expect(LIMIT_BYTES).toBe(64 * MB)
  })
})

describe("外发记录", () => {
  it("它自己发了多少、收了多少、它跑的命令发了多少、最凶的那一分钟", () => {
    const meter = createEgressMeter()
    const traffic = (sent: number, received: number, tool: number): Map<number, Traffic> =>
      new Map([[200, { sent: sent * MB, received: received * MB }], [201, { sent: tool * MB, received: 0 }]])
    const living = new Set([200, 201])
    observe(meter, 0, { watched: [CLAUDE], traffic: traffic(0, 0, 0), living })
    observe(meter, 3000, { watched: [CLAUDE], traffic: traffic(2, 5, 1), living })
    observe(meter, 6000, { watched: [CLAUDE], traffic: traffic(3, 9, 1), living })
    const [claude] = recordsOf(meter)
    expect(claude).toMatchObject({ label: "Claude Code", sent: 3 * MB, received: 9 * MB, toolSent: 1 * MB, peak: 3 * MB })
  })
})
