import { describe, expect, it } from "vitest"
import { createVerify, createPublicKey } from "node:crypto"
import { authHeader, encrypt, generateVapid, type PushSubscription, type Vapid } from "./push.js"

/**
 * 加密这块**对着 RFC 8291 §5 的官方测试向量逐字节验**。
 *
 * 这是自己写这段代码的前提：一个能对上官方向量的实现，比一个「看起来能跑」
 * 的依赖更让人放心——后者出问题时你还得先读它的源码。
 */
const VECTOR = {
  plaintext: "When I grow up, I want to be a watermelon",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  expected:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
}

const sub = (): PushSubscription => ({
  endpoint: "https://push.example.com/x/abc",
  p256dh: VECTOR.uaPublic,
  auth: VECTOR.auth,
})

describe("RFC 8291 的官方向量", () => {
  it("**逐字节相同**", () => {
    const out = encrypt(
      sub(),
      VECTOR.plaintext,
      Buffer.from(VECTOR.salt, "base64url"),
      Buffer.from(VECTOR.asPrivate, "base64url"),
    )
    expect(out.toString("base64url")).toBe(VECTOR.expected)
  })

  it("头部按 RFC 8188 排：salt(16) | rs(4) | idlen(1) | 服务端公钥(65)", () => {
    const out = encrypt(
      sub(),
      VECTOR.plaintext,
      Buffer.from(VECTOR.salt, "base64url"),
      Buffer.from(VECTOR.asPrivate, "base64url"),
    )
    expect(out.subarray(0, 16).toString("base64url")).toBe(VECTOR.salt)
    expect(out.readUInt32BE(16)).toBe(4096)
    expect(out[20]).toBe(65)
    expect(out.length).toBe(16 + 4 + 1 + 65 + VECTOR.plaintext.length + 1 + 16)
  })

  it("每次加密的 salt 与临时密钥都不同——同一条消息不该产出同一串密文", () => {
    const a = encrypt(sub(), "同一句话")
    const b = encrypt(sub(), "同一句话")
    expect(a.equals(b)).toBe(false)
  })

  it("长短不同的正文都编得出来（记录只有一条，不分片）", () => {
    // 头 86（salt 16 + rs 4 + idlen 1 + 公钥 65）＋ 正文 ＋ 分隔符 1 ＋ GCM 标签 16
    for (const text of ["", "a", "中文".repeat(500)]) {
      const out = encrypt(sub(), text)
      expect(out.length).toBe(86 + Buffer.byteLength(text, "utf8") + 1 + 16)
    }
  })
})

describe("VAPID", () => {
  const vapid = (): Vapid => generateVapid("mailto:me@example.com")

  it("公钥是 65 字节的未压缩点（前端的 applicationServerKey 要这个形状）", () => {
    const point = Buffer.from(vapid().publicKey, "base64url")
    expect(point.length).toBe(65)
    expect(point[0]).toBe(4)
  })

  it("私钥是 32 字节标量", () => {
    expect(Buffer.from(vapid().privateKey, "base64url").length).toBe(32)
  })

  it("**签名验得过**——用它自己的公钥", () => {
    const key = vapid()
    const header = authHeader(key, "https://push.example.com/x/abc", 1_760_000_000_000)
    const jwt = header.slice("vapid t=".length, header.indexOf(", k="))
    const [head, claims, sig] = jwt.split(".")
    const point = Buffer.from(key.publicKey, "base64url")
    const pub = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    })
    const raw = Buffer.from(sig ?? "", "base64url")
    expect(raw.length).toBe(64)
    const okay = createVerify("SHA256")
      .update(`${head ?? ""}.${claims ?? ""}`)
      .end()
      .verify({ key: pub, dsaEncoding: "ieee-p1363" }, raw)
    expect(okay).toBe(true)
  })

  it("**`aud` 是推送服务的 origin，不是完整 URL**——写错了对方一律拒", () => {
    const header = authHeader(vapid(), "https://fcm.googleapis.com/fcm/send/xyz?q=1", 0)
    const jwt = header.slice("vapid t=".length, header.indexOf(", k="))
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      aud: string
      exp: number
      sub: string
    }
    expect(claims.aud).toBe("https://fcm.googleapis.com")
    expect(claims.sub).toBe("mailto:me@example.com")
  })

  it("有效期十二小时——规范上限是二十四，留出时钟偏差的余量", () => {
    const now = 1_760_000_000_000
    const header = authHeader(vapid(), "https://push.example.com/x", now)
    const jwt = header.slice("vapid t=".length, header.indexOf(", k="))
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp: number }
    expect(claims.exp).toBe(Math.floor(now / 1000) + 12 * 3600)
  })

  it("头里带着公钥（`k=`），对方拿它验签", () => {
    const key = vapid()
    expect(authHeader(key, "https://push.example.com/x", 0)).toContain(`k=${key.publicKey}`)
  })

  it("**每次生成的密钥都不同**——换了它所有设备都要重新订阅", () => {
    expect(generateVapid("mailto:a@b.c").publicKey).not.toBe(generateVapid("mailto:a@b.c").publicKey)
  })
})
