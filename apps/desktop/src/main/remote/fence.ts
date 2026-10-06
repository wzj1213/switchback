/**
 * 每一个进 `/api` 的请求都要过的信任闸。
 *
 * ## 为什么「只 listen 127.0.0.1」不等于安全
 *
 * 这是我原本漏掉的一条，从 dsh 的 `api-request-trust.ts` 学来的：
 * **浏览器是一个可以被骗的代理人**。攻击者的网页把 `evil.com` 的 DNS
 * 解析改成 `127.0.0.1`（DNS rebinding），于是浏览器认为自己在和 `evil.com`
 * 说话——同源策略放行——而套接字落在你本机这台服务器上，响应能被那个页面读走。
 * 绑回环挡不住它：连接本来就来自本机。
 *
 * 挡得住的是 **`Host` 头**：浏览器按它以为自己在访问的地址填这个头，
 * 而**改绑 DNS 伪造不了它**。所以每一个请求——看起来像不像浏览器发的都一样——
 * 都必须报出一个「是我们」的 Host。
 *
 * ## 为什么不能只在「看起来像浏览器」时才查
 *
 * 明文 HTTP 下，浏览器对**图片和导航这类读取**既不带 `Origin` 也不带
 * Fetch-Metadata（那些头只发给可信目标）。也就是说一个被改绑的浏览器读取
 * 和一次 `curl` 在头上分不出来，而它的响应**是能被那个页面读到的**。
 * 所以没有「没标记就放行」这条捷径。
 *
 * ## 这不是鉴权
 *
 * 这一层只回答「这个请求是不是冲着我们来的」。「你是谁」由设备令牌回答
 *（`tokens.ts`）。两层都要过。
 */

/** 请求里这一层要读的东西。Node 的 `IncomingHttpHeaders` 和 Fetch 的 `Headers` 都能喂进来。 */
export interface FenceHeaders {
  get: (name: string) => string | undefined
}

/** 把 Node 的头对象包成 `FenceHeaders`。 */
export function headersOf(raw: Readonly<Record<string, string | string[] | undefined>>): FenceHeaders {
  return {
    get: (name) => {
      const value = raw[name.toLowerCase()]
      return typeof value === "string" ? value : undefined
    },
  }
}

/**
 * 一个 authority（`host` 或 `host:port`）解析成 URL；解析不了返回 undefined。
 *
 * 借 `http:` 这个 WHATWG「特殊 scheme」：它要么给出非空 hostname，要么抛。
 */
function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/** 回环：`localhost` 本身、127.0.0.0/8、`::1`。**子域不算**（`foo.localhost` 可以指向任何地方）。 */
export function isLoopbackHostname(hostname: string): boolean {
  const bare = hostname.toLowerCase()
  if (bare === "localhost") return true
  if (bare === "[::1]" || bare === "::1") return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)
}

/**
 * 一条 `trustedHosts` 配置项的规范形式：写了端口就是 `hostname:port`，没写就是 `hostname`。
 *
 * 端口从**两种 scheme 各解析一次**来判，而不是看原始字符串：
 * 两者默认端口不同，所以 `:80` 和 `:443` 都仍然算「显式写了」。
 */
function canonicalAuthority(entry: string, parsed: URL): string {
  const port = parsed.port !== "" ? parsed.port : new URL(`https://${entry}`).port
  return port === "" ? parsed.hostname : `${parsed.hostname}:${port}`
}

/**
 * 校验一条配置项是**裸 authority**，否则**大声失败**。
 *
 * 悄悄忽略一条打错的配置，后果是它一直 403 却没人知道为什么；
 * 而更坏的一类是**悄悄扩大授权**：`switchback.example.com/path` 会授权其中的主机名，
 * `switchback.example.com:` 这种悬空冒号会把「只信这个端口」放宽成「任意端口」。
 */
export function assertTrustedAuthority(entry: string): void {
  const parsed = parseAuthority(entry)
  if (parsed !== undefined && canonicalAuthority(entry, parsed) === entry.toLowerCase()) return
  throw new Error(`remote: trustedHosts 里的 ${JSON.stringify(entry)} 不是一个裸 host[:port]`)
}

/**
 * 请求的 authority 命中了某条 `trustedHosts` 吗。
 *
 * 写了端口的只配那一个 authority；没写端口的配该主机名的**任意端口**
 *（隧道那头的端口可能是随机的）。两边都过一遍 WHATWG 规范化，
 * 所以大小写和多余的 `:80` 不会决定信任。
 */
function isTrustedAuthority(host: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const parsed = parseAuthority(entry)
    if (parsed === undefined) return false
    return canonicalAuthority(entry, parsed) === parsed.hostname
      ? parsed.hostname === host.hostname
      : parsed.host === host.host
  })
}

/** 拒绝的理由。**说得出是哪一关拦的**，否则排查时只能盯着一个 403 发呆。 */
export type FenceVerdict = { ok: true } | { ok: false; reason: string }

/**
 * 这个请求能不能进。
 * @param trustedHosts 这次部署对外服务的非回环 authority。隧道那头的域名要写在这里。
 */
export function checkRequest(headers: FenceHeaders, trustedHosts: readonly string[]): FenceVerdict {
  const host = headers.get("host")
  if (host === undefined) return { ok: false, reason: "没有 Host 头" }
  const parsed = parseAuthority(host)
  if (parsed === undefined) return { ok: false, reason: `Host 解析不了：${host}` }
  if (!isLoopbackHostname(parsed.hostname) && !isTrustedAuthority(parsed, trustedHosts)) {
    return { ok: false, reason: `Host 既不是回环也不在 trustedHosts 里：${host}` }
  }
  // 现代浏览器会在每次 fetch 上标出发起方关系；明确标了跨站的一律拒，不看 Origin
  if (headers.get("sec-fetch-site") === "cross-site") return { ok: false, reason: "标了 cross-site" }
  // 带了 Origin 就必须**正好是这个 authority**。没带不算问题——上面的 Host 闸已经拦过一道。
  // 字面量 "null"（沙箱 iframe、file: 页面）是不透明来源，解析不出 host，照样拒
  const origin = headers.get("origin")
  if (origin === undefined) return { ok: true }
  try {
    return new URL(origin).host === parsed.host ? { ok: true } : { ok: false, reason: `Origin 对不上：${origin}` }
  } catch {
    return { ok: false, reason: `Origin 解析不了：${origin}` }
  }
}
