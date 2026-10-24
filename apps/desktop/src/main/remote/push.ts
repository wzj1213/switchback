import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto"

/**
 * Web Push 的加密与鉴权。**不引任何依赖**——`node:crypto` 就够。
 *
 * 三份规范拼起来：
 *
 * | 规范 | 管什么 |
 * | --- | --- |
 * | RFC 8291 | 消息加密（ECDH + HKDF + AES-128-GCM） |
 * | RFC 8188 | `aes128gcm` 的内容编码（头部怎么排） |
 * | RFC 8292 | VAPID：用一个 ES256 的 JWT 证明「这条推送是我发的」 |
 *
 * ## 为什么敢自己写
 *
 * 因为它有**官方测试向量**（RFC 8291 §5），能验到字节。
 * `push.test.ts` 里那条就是它，逐字符比对。一个能对上官方向量的实现，
 * 比一个「看起来能跑」的依赖更让人放心——后者出问题时你还得先读它的源码。
 *
 * ## 推送里放什么
 *
 * **只放能公开的那点**：会话标题和一句话。推送要经过 Apple / Google 的
 * 推送服务，虽然内容是端到端加密的（这个文件干的就是这件事），但
 * **端点本身在他们那儿**。所以正文里不放命令原文、不放代码、不放路径——
 * 那些等你打开应用再看。
 */

const b64u = (buf: Buffer): string => buf.toString("base64url")
const un = (text: string): Buffer => Buffer.from(text, "base64url")

/** HKDF：extract 出 PRK，再 expand 出定长的 key。这里只取一轮，够 32 字节。 */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest()
  const okm = createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
  return okm.subarray(0, length)
}

/** 浏览器 `PushManager.subscribe()` 给的那三样。 */
export interface PushSubscription {
  endpoint: string
  /** 客户端的 P-256 公钥（未压缩点，base64url）。 */
  p256dh: string
  /** 16 字节的共享密钥（base64url）。 */
  auth: string
}

export interface Vapid {
  /** base64url 的未压缩公钥点（65 字节）。前端的 `applicationServerKey` 用这个。 */
  publicKey: string
  /** base64url 的私钥标量（32 字节）。**只在本机，不发给任何人。** */
  privateKey: string
  /** `mailto:` 或 https 地址。推送服务出问题时它们照这个找人。 */
  subject: string
}

/** 造一对 VAPID 密钥。**换了它，所有已订阅的设备都要重新订阅。** */
export function generateVapid(subject: string): Vapid {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const pub = publicKey.export({ format: "jwk" })
  const priv = privateKey.export({ format: "jwk" })
  // JWK 的 x/y/d 就是 base64url 的坐标与标量；未压缩点 = 0x04 || x || y
  const point = Buffer.concat([Buffer.from([4]), un(pub.x ?? ""), un(pub.y ?? "")])
  return { publicKey: b64u(point), privateKey: priv.d ?? "", subject }
}

/** 编码用的固定参数。`rs` 只有一条记录时填多少都行，照规范给 4096。 */
const RECORD_SIZE = 4096

/**
 * 一条记录装得下多少明文。
 *
 * `rs` 是**密文加上分隔符**的上限：减掉 16 字节 GCM tag 和 1 字节分隔符
 * 才是明文的空间。这里只发一条记录，所以超了不是「分成两条」，
 * 而是**发出去一条对端解不开的东西**——表现是通知一声不响，
 * 而那恰恰发生在正文最长的时候（一条长命令要你批）。
 *
 * 另外推送服务自己也有上限（多数是 4 KB），所以这条闸不只是编码问题。
 */
const MAX_PAYLOAD = RECORD_SIZE - 16 - 1

/**
 * 按 RFC 8291 加密一条消息。
 *
 * @param salt 只在对官方向量时传；生产里省略，用随机的。
 * @param serverPrivate 同上。
 */
export function encrypt(
  sub: PushSubscription,
  payload: string,
  salt: Buffer = randomBytes(16),
  serverPrivate?: Buffer,
): Buffer {
  const clientPublic = un(sub.p256dh)
  const auth = un(sub.auth)

  const ecdh = createECDH("prime256v1")
  if (serverPrivate === undefined) ecdh.generateKeys()
  else ecdh.setPrivateKey(serverPrivate)
  const serverPublic = ecdh.getPublicKey()
  const shared = ecdh.computeSecret(clientPublic)

  // RFC 8291 §3.3：先用 auth secret 把 ECDH 结果收成 IKM。
  // **两个公钥的顺序是规定死的**（先客户端后服务端），反了就解不开
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), clientPublic, serverPublic])
  const ikm = hkdf(auth, shared, keyInfo, 32)
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16)
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12)

  // RFC 8188：明文后面跟一个 0x02 的分隔符（表示这是最后一条记录）
  const raw = Buffer.from(payload, "utf8")
  // **越界就抛，不裁。** 这里拿到的是一整份 JSON，从中间截断只会让
  // service worker 那侧 `JSON.parse` 抛——通知同样不响，而排查时
  // 看到的是「推送服务返回 201」，一切正常的样子。裁要在**组 JSON 之前**裁文字
  //（见 `relay.ts`），这一条是最后一道明确的失败
  // i18n-ok：推送发不出去只记日志，不上界面
  if (raw.length > MAX_PAYLOAD) throw new Error(`推送载荷 ${String(raw.length)} 字节，超过一条记录的 ${String(MAX_PAYLOAD)}`)
  const plaintext = Buffer.concat([raw, Buffer.from([2])])
  const cipher = createCipheriv("aes-128-gcm", cek, nonce)
  const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])

  // RFC 8188 §2.1 的头：salt(16) | rs(4) | idlen(1) | keyid(= 服务端公钥)
  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(RECORD_SIZE, 0)
  return Buffer.concat([salt, rs, Buffer.from([serverPublic.length]), serverPublic, body])
}

/** DER 的 ECDSA 签名 → JOSE 要的裸 `r || s`（各 32 字节）。 */
function derToJose(der: Buffer): Buffer {
  const out = Buffer.alloc(64)
  let at = der[1] !== undefined && der[1] > 0x80 ? 2 + (der[1] - 0x80) : 2
  for (const slot of [0, 32]) {
    const len = der[at + 1] ?? 0
    const raw = der.subarray(at + 2, at + 2 + len)
    at += 2 + len
    // DER 为了表示正数会补一个前导 0，去掉；再右对齐到 32 字节
    const trimmed = raw[0] === 0 ? raw.subarray(1) : raw
    trimmed.copy(out, slot + (32 - trimmed.length))
  }
  return out
}

/** 从裸标量拼一个 node 认的 EC 私钥。node 没有「从标量造私钥」的直接入口。 */
function privateKeyOf(vapid: Vapid): ReturnType<typeof createPrivateKey> {
  const point = un(vapid.publicKey)
  return createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: vapid.privateKey,
      x: b64u(point.subarray(1, 33)),
      y: b64u(point.subarray(33, 65)),
    },
    format: "jwk",
  })
}

/** JWT 有效期。规范上限 24 小时，取 12 小时留出时钟偏差的余量。 */
const JWT_TTL_S = 12 * 3600

/** 造一个 VAPID 的 `Authorization` 头。`aud` 必须是推送服务的 origin。 */
export function authHeader(vapid: Vapid, endpoint: string, now: number): string {
  const aud = new URL(endpoint).origin
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" }), "utf8"))
  const claims = b64u(
    Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + JWT_TTL_S, sub: vapid.subject }), "utf8"),
  )
  const signing = `${header}.${claims}`
  const der = createSign("SHA256").update(signing).end().sign(privateKeyOf(vapid))
  return `vapid t=${signing}.${b64u(derToJose(der))}, k=${vapid.publicKey}`
}

export interface PushResult {
  ok: boolean
  status: number
  /**
   * 这个订阅已经死了（404 / 410），**要从设备表里删掉**。
   *
   * 用户卸载了 PWA、清了站点数据、或者推送服务自己过期了——
   * 留着它只会每次都白发一次请求，而且日志里一直是同一条错误。
   */
  gone: boolean
  /** 失败时的人话。**别丢**：`status: 0` 既可能是网断了，也可能是载荷超长。 */
  reason?: string
}

export interface SendRequest {
  vapid: Vapid
  sub: PushSubscription
  payload: string
  now: number
  /** 推送服务替我们留多久。默认一小时——**过了这个点的「有人在等你」已经没意义了**。 */
  ttl?: number
}

/** 推一条。**不抛**——一次推送失败不该影响任何别的事。 */
export async function send({ vapid, sub, payload, now, ttl = 3600 }: SendRequest): Promise<PushResult> {
  try {
    const body = encrypt(sub, payload)
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        authorization: authHeader(vapid, sub.endpoint, now),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(ttl),
        urgency: "high",
      },
      body: new Uint8Array(body),
    })
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 }
  } catch (error) {
    // 网络不通、endpoint 解析不了、载荷超长——都当一次普通失败，下次再说。
    // **原因要带出去**：`status: 0` 光看数字分不出「网断了」和「这条永远发不出去」
    return { ok: false, status: 0, gone: false, reason: String(error) }
  }
}
