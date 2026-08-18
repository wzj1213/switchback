import { afterEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { request } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import WebSocket from "ws"
import type { Command, Event, Trust } from "@omni/protocol"
import { createLedger, createReassembler, type ServerFrame } from "@omni/wire"
import { createTokenStore, type Device } from "./tokens.js"
import { startRemote, WS_PROTOCOL, type RemoteServer } from "./server.js"
import type { Sink } from "../sink.js"

/**
 * 真起一个服务端、真配一次对、真连一条 WebSocket。
 *
 * 这一条测的是**接线**，不是任何一个零件——零件各有各的表驱动测试。
 * 接线错了的表现是「每个单元测试都绿，跑起来什么都不动」，
 * 而那正是只有集成测试逮得到的一类。
 */

const RUN = "run-a"

const ev = (n: number): Event => ({ type: "item.delta", at: n, itemId: "i", append: String(n) })

interface Harness {
  server: RemoteServer
  base: string
  ledger: ReturnType<typeof createLedger>
  dispatched: Command[]
  sinks: Sink[]
  code: () => string
  replays: () => number
}

const running: RemoteServer[] = []

interface BootOptions {
  maxTrust?: Trust
  trustedHosts?: readonly string[]
  threadTrust?: Trust
  history?: readonly Event[]
  /** 把死连接的判定拨快，别让一条测试跑将近一分钟。 */
  heartbeat?: { everyMs: number; deadAfterMs: number }
  /** 在 webRoot 下铺几个文件，用来验压缩与缓存头。 */
  webRoot?: boolean
}

async function boot(options: BootOptions = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "omni-remote-"))
  const file = join(dir, "devices.json")
  writeFileSync(file, "[]", "utf8")
  if (options.webRoot === true) {
    mkdirSync(join(dir, "assets"), { recursive: true })
    // 够大才压得到（阈值 1024）
    writeFileSync(join(dir, "assets", "big.js"), `// 巨大\n${"x".repeat(5000)}`, "utf8")
    writeFileSync(join(dir, "small.txt"), "短", "utf8")
    writeFileSync(join(dir, "pic.png"), Buffer.alloc(5000, 7))
  }
  const disk: { devices: readonly Device[] } = { devices: [] }
  const tokens = createTokenStore({
    load: () => disk.devices,
    save: (devices) => {
      disk.devices = devices
    },
    now: () => Date.now(),
  })
  const ledger = createLedger(RUN, 100)
  const dispatched: Command[] = []
  const sinks: Sink[] = []
  const state = { replays: 0, pairing: "" }

  const server = await startRemote({
    config: () => ({
      port: 0,
      trustedHosts: options.trustedHosts ?? [],
      maxTrust: options.maxTrust ?? "full",
    }),
    webRoot: dir,
    pushKey: () => "测试用的假公钥",
    tokens,
    ledger,
    sinks: {
      list: () => sinks,
      add: (sink) => {
        sinks.push(sink)
        return () => {
          sinks.splice(sinks.indexOf(sink), 1)
        }
      },
    },
    dispatch: (command) => dispatched.push(command),
    trustOf: () => options.threadTrust,
    history: async () => options.history ?? [],
    ...(options.heartbeat === undefined ? {} : { heartbeat: options.heartbeat }),
    replay: async (sink) => {
      state.replays += 1
      sink.send({ channel: "omni:replay", replay: { events: [ev(0)], resumeAt: ledger.latest(), epoch: RUN } })
      await Promise.resolve()
    },
    log: () => undefined,
  })
  running.push(server)
  return {
    server,
    base: `http://127.0.0.1:${String(server.port())}`,
    ledger,
    dispatched,
    sinks,
    code: () => {
      state.pairing = tokens.startPairing().code
      return state.pairing
    },
    replays: () => state.replays,
  }
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.close()
})

/** 配一次对，返回令牌。 */
async function pairUp(h: Harness, name = "测试机"): Promise<string> {
  const code = h.code()
  const res = await fetch(`${h.base}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name }),
  })
  const body = (await res.json()) as { token?: string }
  return body.token ?? ""
}

/** 连一条 WebSocket，收帧收到满足条件为止。 */
function connect(h: Harness, token: string): Promise<{ socket: WebSocket; frames: ServerFrame[] }> {
  return new Promise((done, fail) => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(h.server.port())}/api/stream`, [WS_PROTOCOL, token])
    const frames: ServerFrame[] = []
    const reassembler = createReassembler()
    socket.on("message", (data) => {
      const seen = reassembler.observe(String(data))
      if (seen.kind === "frame") frames.push(seen.frame)
    })
    socket.on("open", () => {
      done({ socket, frames })
    })
    socket.on("error", fail)
  })
}

const settle = async (ms = 60): Promise<void> => {
  await new Promise((r) => setTimeout(r, ms))
}

/**
 * 裸 HTTP 请求。
 *
 * **不能用 `fetch` 测这两件事**：① `Host` 是禁止头，undici 不许覆写，
 * 于是「伪造 Host」这个实验根本发不出去；② WHATWG 的 URL 解析会在发送前
 * 把 `%2e%2e` 规范化掉，于是「路径穿越」到不了服务端。
 * 两条都要**绕过客户端的好意**，才测得到服务端自己拦不拦。
 */
function raw(port: number, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      res.resume()
      done(res.statusCode ?? 0)
    })
    req.on("error", fail)
    req.end()
  })
}

/** 同上，但要正文——403 说不说得出理由是靠正文验的。 */
function rawBody(port: number, path: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      let body = ""
      res.setEncoding("utf8")
      res.on("data", (chunk: string) => (body += chunk))
      res.on("end", () => {
        done(body)
      })
    })
    req.on("error", fail)
    req.end()
  })
}

describe("配对", () => {
  it("码对了就换到令牌，`/api/me` 认得出它", async () => {
    const h = await boot()
    const token = await pairUp(h, "iPhone")
    expect(token).not.toBe("")
    const me = await fetch(`${h.base}/api/me`, { headers: { authorization: `Bearer ${token}` } })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ name: "iPhone", maxTrust: "full" })
  })

  it("码不对回 403，且不吐令牌", async () => {
    const h = await boot()
    h.code()
    const res = await fetch(`${h.base}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "ZZZZZZZZ", name: "坏人" }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).not.toHaveProperty("token")
  })

  it("没有令牌时 `/api/me` 是 401", async () => {
    const h = await boot()
    expect((await fetch(`${h.base}/api/me`)).status).toBe(401)
  })
})

describe("Host 闸真的在拦", () => {
  it("**Host 不是我们的就 403**，哪怕请求确实来自本机——那正是 DNS 改绑的样子", async () => {
    const h = await boot()
    expect(await raw(h.server.port(), "/api/me", { host: "evil.com" })).toBe(403)
  })

  it("后缀撞名不算命中", async () => {
    const h = await boot({ trustedHosts: ["omni.example.com"] })
    expect(await raw(h.server.port(), "/api/me", { host: "omni.example.com.evil.com" })).toBe(403)
  })

  it("配进 trustedHosts 就放行", async () => {
    const h = await boot({ trustedHosts: ["omni.example.com:8443"] })
    // 过了闸，但没带令牌 → 401 而不是 403。**两个状态码分得开**才说明这是两层
    expect(await raw(h.server.port(), "/api/me", { host: "omni.example.com:8443" })).toBe(401)
  })

  it("Origin 和 Host 对不上就 403", async () => {
    const h = await boot()
    expect(await raw(h.server.port(), "/api/me", { origin: "http://evil.com" })).toBe(403)
  })

  it("升级请求也过同一道闸", async () => {
    const h = await boot()
    const token = await pairUp(h)
    await expect(
      new Promise((done, fail) => {
        const socket = new WebSocket(`ws://127.0.0.1:${String(h.server.port())}/api/stream`, [WS_PROTOCOL, token], {
          headers: { host: "evil.com" },
        })
        socket.on("open", () => {
          done("居然连上了")
        })
        socket.on("error", fail)
      }),
    ).rejects.toThrow()
  })
})

describe("WebSocket", () => {
  it("令牌不对连不上", async () => {
    const h = await boot()
    await pairUp(h)
    await expect(connect(h, "乱写的")).rejects.toThrow()
  })

  it("连上之后 hello 换回一份全量，并注册成一个 sink", async () => {
    const h = await boot()
    const token = await pairUp(h)
    const { socket, frames } = await connect(h, token)
    socket.send(JSON.stringify({ type: "hello" }))
    await settle()
    expect(h.replays()).toBe(1)
    expect(frames.some((f) => f.type === "replay")).toBe(true)
    expect(h.sinks).toHaveLength(1)
    socket.close()
  })

  it("**事件真的推得到浏览器那一端**", async () => {
    const h = await boot()
    const token = await pairUp(h)
    const { socket, frames } = await connect(h, token)
    socket.send(JSON.stringify({ type: "hello" }))
    await settle()
    const sealed = h.ledger.seal([ev(7)])
    for (const sink of h.sinks) sink.send({ channel: "omni:events", sealed })
    await settle()
    const events = frames.filter((f) => f.type === "events")
    expect(events.at(-1)?.type === "events" ? events.at(-1)?.sealed.length : 0).toBe(1)
    socket.close()
  })

  it("命令走到 dispatch", async () => {
    const h = await boot()
    const token = await pairUp(h)
    const { socket } = await connect(h, token)
    socket.send(JSON.stringify({ type: "command", command: { type: "thread.prompt", threadId: "t", text: "hi" } }))
    await settle()
    expect(h.dispatched).toEqual([{ type: "thread.prompt", threadId: "t", text: "hi" }])
    socket.close()
  })

  it("**档位上限在服务端生效**——浏览器那边改 JS 绕不过去", async () => {
    const h = await boot({ maxTrust: "read-only" })
    const token = await pairUp(h)
    const { socket } = await connect(h, token)
    socket.send(
      JSON.stringify({
        type: "command",
        command: { type: "thread.create", cwd: "/w", engine: "codex", trust: "full" },
      }),
    )
    await settle()
    expect(h.dispatched[0]).toMatchObject({ trust: "read-only" })
    socket.close()
  })

  it("断开之后从账本里摘掉，不再钉住保留下限", async () => {
    const h = await boot()
    const token = await pairUp(h)
    const { socket } = await connect(h, token)
    socket.send(JSON.stringify({ type: "hello" }))
    await settle()
    expect(Object.keys(h.ledger.stats().acked)).toHaveLength(1)
    socket.close()
    await settle(120)
    expect(Object.keys(h.ledger.stats().acked)).toHaveLength(0)
    expect(h.sinks).toHaveLength(0)
  })
})

describe("被闸门拦下时说得出为什么", () => {
  it("**403 的正文要指向要改的那一栏**——手机上只看到「Forbidden」四个字母时，没有任何线索指向桌面那台", async () => {
    const h = await boot({ trustedHosts: ["omni.example.com"] })
    // `fetch` 改不了 Host，走裸 http
    const body = await rawBody(h.server.port(), "/api/me", { host: "someone-else.example.com" })
    expect(body).toContain("trustedHosts")
    expect(body).toContain("远程访问")
    expect(body).toContain("不要带 https://")
  })
})

describe("半开的连接", () => {
  it("**没动静就判死**——手机进电梯之后那条 socket 会以「还连着」的样子挂很久", async () => {
    const h = await boot({ heartbeat: { everyMs: 20, deadAfterMs: 60 } })
    const token = await pairUp(h)
    const { socket } = await connect(h, token)
    expect(h.sinks).toHaveLength(1)
    await settle(300)
    expect(h.sinks).toHaveLength(0)
    expect(Object.keys(h.ledger.stats().acked)).toHaveLength(0)
    expect(socket.readyState).not.toBe(WebSocket.OPEN)
  })

  it("**还在发帧的就别动它**——判早了会把一条活连接踢掉，而它重连要走一次全量", async () => {
    const h = await boot({ heartbeat: { everyMs: 20, deadAfterMs: 200 } })
    const token = await pairUp(h)
    const { socket } = await connect(h, token)
    for (let i = 0; i < 6; i += 1) {
      socket.send(JSON.stringify({ type: "ping" }))
      await settle(40)
    }
    expect(h.sinks).toHaveLength(1)
    socket.close()
  })
})

describe("压缩", () => {
  it("**认 gzip 的对端拿到压过的那份**——这一端的产物 377 KB，压完 115 KB，隔着隧道是一秒和三秒的差别", async () => {
    const h = await boot({ webRoot: true })
    const res = await fetch(`${h.base}/assets/big.js`, { headers: { "accept-encoding": "gzip" } })
    expect(res.headers.get("content-encoding")).toBe("gzip")
    // **`vary` 少了的话**，中间任何一层缓存都可能把压过的那份喂给不认 gzip 的客户端
    expect(res.headers.get("vary")).toBe("accept-encoding")
  })

  it("不认 gzip 的照样拿得到，只是没压", async () => {
    const h = await boot({ webRoot: true })
    const body = await rawBody(h.server.port(), "/assets/big.js", { "accept-encoding": "identity" })
    expect(body).toContain("巨大")
  })

  it("**小文件不压**——包头加 zlib 的固定开销比省下来的还多", async () => {
    const h = await boot({ webRoot: true })
    const res = await fetch(`${h.base}/small.txt`, { headers: { "accept-encoding": "gzip" } })
    expect(res.headers.get("content-encoding")).toBeNull()
  })

  it("**图片不压**——已经压过的再压一遍是纯烧 CPU，还可能变大", async () => {
    const h = await boot({ webRoot: true })
    const res = await fetch(`${h.base}/pic.png`, { headers: { "accept-encoding": "gzip" } })
    expect(res.headers.get("content-encoding")).toBeNull()
  })
})

describe("HTTP 杂项", () => {
  it("普通 GET 打到 WebSocket 那条路径上回 426，不退化成别的东西", async () => {
    const h = await boot()
    expect((await fetch(`${h.base}/api/stream`)).status).toBe(426)
  })

  it("没有前端产物时页面 404，但 API 照常通——**问题范围一眼缩到「前端没构建」**", async () => {
    const h = await boot()
    expect((await fetch(`${h.base}/`)).status).toBe(404)
    expect((await fetch(`${h.base}/api/me`)).status).toBe(401)
  })

  it("路径穿越被挡在 400（百分号编码的点点也算）", async () => {
    const h = await boot()
    expect(await raw(h.server.port(), "/%2e%2e/%2e%2e/etc/passwd")).toBe(400)
    expect(await raw(h.server.port(), "/../../etc/passwd")).toBe(400)
  })
})
