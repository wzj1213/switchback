import { afterEach, describe, expect, it } from "vitest"
import { request } from "node:http"
import WebSocket from "ws"
import type { Trust } from "@switchback/protocol"
import { createLedger, createReassembler, type ServerFrame } from "@switchback/wire"
import { createTokenStore, type Device, type DeviceKind } from "./tokens.js"
import { startRemote, WS_PROTOCOL, type RemoteServer } from "./server.js"

/**
 * 远程模式的接线（`docs/远程模式方案.md`）：真起服务端、真配对、真连 WebSocket、真发 `call`。
 *
 * 零件（白名单、按设备判、配对与回话）各有表驱动测试；这一条只管「接上之后真的是那样」——
 * 接线错了的表现是每个单元测试都绿、另一台电脑上点什么都没反应。
 */

const running: RemoteServer[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()))
})

async function boot(maxTrust: Trust = "auto-edit") {
  const disk: { devices: readonly Device[] } = { devices: [] }
  const tokens = createTokenStore({
    load: () => disk.devices,
    save: (devices) => {
      disk.devices = devices
    },
    now: () => Date.now(),
  })
  const replayedAs: DeviceKind[] = []
  const handled: { name: string; arg: unknown }[] = []
  const server = await startRemote({
    config: () => ({ port: 0, trustedHosts: [], maxTrust }),
    language: () => "zh-CN",
    webRoot: "/nonexistent",
    pushKey: () => "k",
    tokens,
    ledger: createLedger("run", 10),
    sinks: { list: () => [], add: () => () => undefined },
    dispatch: () => undefined,
    trustOf: () => undefined,
    history: async () => ({ events: [], trimmed: false }),
    replay: async (sink, kind) => {
      replayedAs.push(kind)
      sink.send({ channel: "switchback:replay", replay: { events: [], resumeAt: 0, epoch: "run" } })
      await Promise.resolve()
    },
    channel: (name) =>
      name === "switchback:worksite" || name === "switchback:gitCommit"
        ? (arg) => {
            handled.push({ name, arg })
            return { branch: "main" }
          }
        : undefined,
    log: () => undefined,
  })
  running.push(server)
  const base = `http://127.0.0.1:${String(server.port())}`
  return { tokens, base, replayedAs, handled }
}

function post(url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((done, fail) => {
    const text = JSON.stringify(body)
    const req = request(url, { method: "POST", headers: { "content-type": "application/json" } }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("end", () => {
        done({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> })
      })
    })
    req.on("error", fail)
    req.end(text)
  })
}

async function paired(h: Awaited<ReturnType<typeof boot>>, kind: DeviceKind): Promise<string> {
  const { code } = h.tokens.startPairing(kind)
  const answer = await post(`${h.base}/api/pair`, { code, name: kind === "desk" ? "mac2" : "iPhone" })
  return String(answer.json["token"])
}

/** 连上、hello、发一条 call，收那条 result。 */
async function callOnce(base: string, token: string, method: string, arg?: unknown): Promise<ServerFrame> {
  const ws = new WebSocket(`${base.replace("http", "ws")}/api/stream`, [WS_PROTOCOL, token])
  const reassembler = createReassembler()
  try {
    return await new Promise<ServerFrame>((done, fail) => {
      ws.on("error", fail)
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "hello" }))
        ws.send(JSON.stringify({ type: "call", id: 1, method, arg }))
      })
      ws.on("message", (data) => {
        const seen = reassembler.observe(String(data))
        if (seen.kind === "frame" && seen.frame.type === "result") done(seen.frame)
      })
    })
  } finally {
    ws.close()
  }
}

describe("远程模式接线", () => {
  it("**按「电脑」配上来的设备能调白名单里的通道**，参数原样交给宿主的处理函数", async () => {
    const h = await boot()
    const token = await paired(h, "desk")
    const result = await callOnce(h.base, token, "switchback:worksite", { threadId: "t", cwd: "/w" })
    expect(result).toEqual({ type: "result", id: 1, ok: true, value: { branch: "main" } })
    expect(h.handled).toEqual([{ name: "switchback:worksite", arg: { threadId: "t", cwd: "/w" } }])
    // 全量按电脑那组预算发
    expect(h.replayedAs).toEqual(["desk"])
  })

  it("**手机端一条通道都调不了**，而且全量按手机那组预算", async () => {
    const h = await boot()
    const token = await paired(h, "phone")
    const result = await callOnce(h.base, token, "switchback:worksite", {})
    expect(result).toMatchObject({ type: "result", id: 1, ok: false })
    expect(h.handled).toEqual([])
    expect(h.replayedAs).toEqual(["phone"])
  })

  it("表外的通道拒，宿主上就算挂着处理函数也不调", async () => {
    const h = await boot()
    const token = await paired(h, "desk")
    const result = await callOnce(h.base, token, "switchback:selfUpdate")
    expect(result).toMatchObject({ ok: false })
    expect(h.handled).toEqual([])
  })

  it("**每台设备自己的上限压过默认**：默认完全，这台调成只读之后就提交不了", async () => {
    const h = await boot("full")
    const token = await paired(h, "desk")
    const id = h.tokens.list()[0]?.id ?? ""
    h.tokens.setTrust(id, "read-only")
    const result = await callOnce(h.base, token, "switchback:gitCommit", {})
    expect(result).toMatchObject({ ok: false })
    expect(h.handled).toEqual([])
  })

  it("「我是谁」报种类，以及**这台设备自己的**上限", async () => {
    const h = await boot("full")
    const token = await paired(h, "desk")
    h.tokens.setTrust(h.tokens.list()[0]?.id ?? "", "auto-edit")
    const me = await new Promise<Record<string, unknown>>((done, fail) => {
      request(`${h.base}/api/me`, { headers: { authorization: `Bearer ${token}` } }, (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c: Buffer) => chunks.push(c))
        res.on("end", () => {
          done(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)
        })
      })
        .on("error", fail)
        .end()
    })
    expect(me).toMatchObject({ name: "mac2", kind: "desk", maxTrust: "auto-edit" })
  })
})

describe("`/desk/` 送桌面界面", () => {
  async function bootWithDesk() {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const root = mkdtempSync(join(tmpdir(), "switchback-desk-"))
    mkdirSync(join(root, "assets"))
    writeFileSync(join(root, "index.html"), "<!doctype html><title>desk</title>", "utf8")
    writeFileSync(join(root, "assets", "index-AbCdEf12.js"), "export {}", "utf8")
    const tokens = createTokenStore({ load: () => [], save: () => undefined, now: () => Date.now() })
    const server = await startRemote({
      config: () => ({ port: 0, trustedHosts: [], maxTrust: "auto-edit" }),
      language: () => "zh-CN",
      webRoot: "/nonexistent",
      deskRoot: root,
      pushKey: () => "k",
      tokens,
      ledger: createLedger("run", 10),
      sinks: { list: () => [], add: () => () => undefined },
      dispatch: () => undefined,
      trustOf: () => undefined,
      history: async () => ({ events: [], trimmed: false }),
      replay: async () => undefined,
      log: () => undefined,
    })
    running.push(server)
    return `http://127.0.0.1:${String(server.port())}`
  }

  function get(url: string): Promise<{ status: number; location?: string; cache?: string; body: string }> {
    return new Promise((done, fail) => {
      request(url, (res) => {
        const chunks: Buffer[] = []
        res.on("data", (c: Buffer) => chunks.push(c))
        res.on("end", () => {
          done({
            status: res.statusCode ?? 0,
            ...(typeof res.headers.location === "string" ? { location: res.headers.location } : {}),
            ...(typeof res.headers["cache-control"] === "string" ? { cache: res.headers["cache-control"] } : {}),
            body: Buffer.concat(chunks).toString("utf8"),
          })
        })
      })
        .on("error", fail)
        .end()
    })
  }

  it("**`/desk` 先补斜杠**——不补的话页面里的相对资源会解析到手机端的产物上", async () => {
    const base = await bootWithDesk()
    expect(await get(`${base}/desk`)).toMatchObject({ status: 308, location: "/desk/" })
  })

  it("`/desk/` 是渲染层的入口页，带哈希的资源永久缓存", async () => {
    const base = await bootWithDesk()
    expect(await get(`${base}/desk/`)).toMatchObject({ status: 200, body: "<!doctype html><title>desk</title>" })
    expect(await get(`${base}/desk/assets/index-AbCdEf12.js`)).toMatchObject({
      status: 200,
      cache: "public, max-age=31536000, immutable",
    })
  })

  it("资源找不到老实 404，不拿入口页兜（那会是一份 content-type 是 JS 的 HTML）", async () => {
    const base = await bootWithDesk()
    expect((await get(`${base}/desk/assets/gone-ZzZzZzZz.js`)).status).toBe(404)
  })
})
