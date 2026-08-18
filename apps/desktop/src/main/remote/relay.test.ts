import { afterEach, describe, expect, it } from "vitest"
import { createDecipheriv, createECDH, createHmac } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { createRelay } from "./relay.js"
import { generateVapid, type PushSubscription } from "./push.js"
import type { Sink } from "../sink.js"
import type { Device, TokenStore } from "./tokens.js"
import type { Logger } from "../log.js"

/**
 * 推送这条路**真发一次、真解一次**。
 *
 * 加密本身已经对着 RFC 向量验过（`push.test.ts`），这里验的是另一件事：
 * relay → HTTP → 一个真的对端，而且**那个对端能用自己的私钥解开**。
 * 中间任何一环把字节弄错（头没排对、密钥顺序反了、`Content-Encoding` 写错），
 * 这条就红。
 */

/** 客户端那侧：造一对密钥 + 一个 auth secret，凑成一个订阅。 */
function subscriber(endpoint: string): { sub: PushSubscription; open: (body: Buffer) => string } {
  const ecdh = createECDH("prime256v1")
  ecdh.generateKeys()
  const auth = Buffer.from("0123456789abcdef", "utf8")
  const sub: PushSubscription = {
    endpoint,
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: auth.toString("base64url"),
  }

  /** RFC 8188 + 8291 的反过程。**独立写一遍**——照着实现抄就验不出什么了。 */
  const open = (body: Buffer): string => {
    const salt = body.subarray(0, 16)
    const idlen = body[20] ?? 0
    const serverPublic = body.subarray(21, 21 + idlen)
    const sealed = body.subarray(21 + idlen)
    const shared = ecdh.computeSecret(serverPublic)
    const hkdf = (s: Buffer, ikm: Buffer, info: Buffer, len: number): Buffer => {
      const prk = createHmac("sha256", s).update(ikm).digest()
      return createHmac("sha256", prk)
        .update(Buffer.concat([info, Buffer.from([1])]))
        .digest()
        .subarray(0, len)
    }
    const keyInfo = Buffer.concat([
      Buffer.from("WebPush: info\0", "utf8"),
      ecdh.getPublicKey(),
      serverPublic,
    ])
    const ikm = hkdf(auth, shared, keyInfo, 32)
    const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16)
    const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12)
    const tag = sealed.subarray(sealed.length - 16)
    const cipher = createDecipheriv("aes-128-gcm", cek, nonce)
    cipher.setAuthTag(tag)
    const plain = Buffer.concat([cipher.update(sealed.subarray(0, sealed.length - 16)), cipher.final()])
    // 末尾那个 0x02 是 RFC 8188 的记录分隔符
    return plain.subarray(0, plain.length - 1).toString("utf8")
  }

  return { sub, open }
}

interface Fake {
  url: string
  /** 收到的请求。 */
  seen: { headers: Record<string, string | string[] | undefined>; body: Buffer }[]
  close: () => Promise<void>
}

/** 一个假的推送服务。`status` 决定它怎么答。 */
async function fakePush(status = 201): Promise<Fake> {
  const seen: Fake["seen"] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => {
      seen.push({ headers: req.headers, body: Buffer.concat(chunks) })
      res.writeHead(status).end()
    })
  })
  await new Promise<void>((done) => {
    server.listen(0, "127.0.0.1", done)
  })
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${String(port)}/push/abc`,
    seen,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => {
          done()
        })
      }),
  }
}

/** 只实现 relay 用得到的那几个方法。 */
function tokensWith(devices: { id: string; name: string; push: PushSubscription }[]): TokenStore {
  const state = { devices: [...devices] }
  return {
    startPairing: () => ({ code: "X", expiresAt: 0 }),
    pending: () => undefined,
    cancelPairing: () => undefined,
    claim: () => ({ ok: false, reason: "不用" }),
    verify: () => undefined,
    list: () => [] as readonly Device[],
    setPush: (id, push) => {
      if (push === undefined) state.devices = state.devices.filter((d) => d.id !== id)
      return true
    },
    pushable: () => state.devices,
    revoke: () => false,
    revokeAll: () => undefined,
  }
}

const noSinks = { list: (): readonly Sink[] => [], add: () => () => undefined }
const quiet: Logger = { write: () => undefined, file: "" }

const servers: Fake[] = []
afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close()
})

const settle = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe("推一条", () => {
  it("**对端用自己的私钥解得开**，内容一字不差", async () => {
    const fake = await fakePush()
    servers.push(fake)
    const { sub, open } = subscriber(fake.url)
    const relay = createRelay({
      tokens: tokensWith([{ id: "d1", name: "手机", push: sub }]),
      sinks: noSinks,
      log: quiet,
      vapid: generateVapid("https://example.com"),
    })
    relay.notify("t-1", "改分页那条", "跑完了，用了 4 分 12 秒")
    await settle()
    expect(fake.seen).toHaveLength(1)
    const got = JSON.parse(open(fake.seen[0]?.body ?? Buffer.alloc(0))) as Record<string, string>
    expect(got).toEqual({ threadId: "t-1", title: "改分页那条", body: "跑完了，用了 4 分 12 秒" })
  })

  it("带齐了推送服务要的头", async () => {
    const fake = await fakePush()
    servers.push(fake)
    const { sub } = subscriber(fake.url)
    createRelay({
      tokens: tokensWith([{ id: "d1", name: "手机", push: sub }]),
      sinks: noSinks,
      log: quiet,
      vapid: generateVapid("https://example.com"),
    }).notify("t-1", "标题", "正文")
    await settle()
    const headers = fake.seen[0]?.headers ?? {}
    expect(headers["content-encoding"]).toBe("aes128gcm")
    expect(String(headers["authorization"])).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/)
    expect(headers["ttl"]).toBe("3600")
  })

  it("有几台设备就推几条", async () => {
    const fake = await fakePush()
    servers.push(fake)
    const a = subscriber(fake.url)
    const b = subscriber(fake.url)
    createRelay({
      tokens: tokensWith([
        { id: "d1", name: "手机", push: a.sub },
        { id: "d2", name: "平板", push: b.sub },
      ]),
      sinks: noSinks,
      log: quiet,
      vapid: generateVapid("https://example.com"),
    }).notify("t-1", "标题", "正文")
    await settle()
    expect(fake.seen).toHaveLength(2)
  })

  it("一台设备都没订阅时一条都不发", async () => {
    const fake = await fakePush()
    servers.push(fake)
    createRelay({ tokens: tokensWith([]), sinks: noSinks, log: quiet, vapid: generateVapid("https://x.com") }).notify(
      "t-1",
      "标题",
      "正文",
    )
    await settle()
    expect(fake.seen).toHaveLength(0)
  })
})

describe("什么时候不推", () => {
  it("**有客户端正开着这条会话的正文就不推**——那时你已经看见了", async () => {
    const fake = await fakePush()
    servers.push(fake)
    const { sub } = subscriber(fake.url)
    const watching: Sink = {
      id: "远程",
      send: () => undefined,
      alive: () => true,
      watching: () => "t-1",
    }
    const relay = createRelay({
      tokens: tokensWith([{ id: "d1", name: "手机", push: sub }]),
      sinks: { list: () => [watching], add: () => () => undefined },
      log: quiet,
      vapid: generateVapid("https://example.com"),
    })
    relay.notify("t-1", "看着的那条", "跑完了")
    relay.notify("t-2", "别的那条", "跑完了")
    await settle()
    // 只推了 t-2 那一条
    expect(fake.seen).toHaveLength(1)
  })

  it("客户端在别的会话上时照推", async () => {
    const fake = await fakePush()
    servers.push(fake)
    const { sub } = subscriber(fake.url)
    const elsewhere: Sink = { id: "远程", send: () => undefined, alive: () => true, watching: () => "t-9" }
    createRelay({
      tokens: tokensWith([{ id: "d1", name: "手机", push: sub }]),
      sinks: { list: () => [elsewhere], add: () => () => undefined },
      log: quiet,
      vapid: generateVapid("https://example.com"),
    }).notify("t-1", "标题", "正文")
    await settle()
    expect(fake.seen).toHaveLength(1)
  })
})

describe("订阅死了就摘掉", () => {
  it("**410 之后不再往那个端点发**——留着只会每次白发一次请求", async () => {
    const fake = await fakePush(410)
    servers.push(fake)
    const { sub } = subscriber(fake.url)
    const tokens = tokensWith([{ id: "d1", name: "手机", push: sub }])
    const relay = createRelay({ tokens, sinks: noSinks, log: quiet, vapid: generateVapid("https://example.com") })
    relay.notify("t-1", "标题", "正文")
    await settle()
    expect(tokens.pushable()).toHaveLength(0)
    relay.notify("t-1", "标题", "正文")
    await settle()
    expect(fake.seen).toHaveLength(1)
  })

  it("普通失败（500）不摘——那可能只是对面抖了一下", async () => {
    const fake = await fakePush(500)
    servers.push(fake)
    const { sub } = subscriber(fake.url)
    const tokens = tokensWith([{ id: "d1", name: "手机", push: sub }])
    createRelay({ tokens, sinks: noSinks, log: quiet, vapid: generateVapid("https://example.com") }).notify(
      "t-1",
      "标题",
      "正文",
    )
    await settle()
    expect(tokens.pushable()).toHaveLength(1)
  })
})
