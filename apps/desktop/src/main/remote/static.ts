import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { join, normalize, resolve, sep } from "node:path"
import { createGzip } from "node:zlib"
import type { IncomingMessage, ServerResponse } from "node:http"

/**
 * 浏览器端那几个静态文件。
 *
 * 单独一个文件是因为**路径穿越只有一处判据**：所有落到磁盘的路径都必须
 * 从这里出去。散在路由里写第二遍，迟早有一遍忘了判。
 */

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
}

/**
 * 这类内容压不压得动。
 *
 * 只压文本。图片、字体（woff2 自带 brotli）、压缩过的东西再压一遍
 * 是纯烧 CPU，还可能变大。
 */
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg)/u

/**
 * 小于这个数的不压。
 *
 * 一个包头 + zlib 的固定开销就有几十字节，压一个 300 字节的图标省不了什么，
 * 而每压一次都要多一次内存分配和一次 CPU。
 */
const COMPRESS_ABOVE = 1024

/**
 * 这一发要不要压。
 *
 * 这一端的产物实测 377 KB（首屏 JS + CSS），gzip 之后 115 KB——
 * 在蜂窝网上隔着一条隧道，那是「一秒」和「三秒」的差别。
 *
 * 三个条件缺一不可：对端认（**只认 gzip**——br 要 `createBrotliCompress`，
 * 慢一个量级，静态文件用不上）、这类内容压得动、而且大到值得压。
 */
function shouldGzip(req: IncomingMessage | undefined, type: string, size: number): boolean {
  const raw = req?.headers["accept-encoding"]
  const text = Array.isArray(raw) ? raw.join(",") : (raw ?? "")
  return /\bgzip\b/u.test(text) && COMPRESSIBLE.test(type) && size > COMPRESS_ABOVE
}

function typeOf(path: string): string {
  const dot = path.lastIndexOf(".")
  return (dot === -1 ? undefined : TYPES[path.slice(dot).toLowerCase()]) ?? "application/octet-stream"
}

/**
 * 把请求路径解析成 root 之内的一个绝对路径；有一点不对就返回 undefined。
 *
 * 四道，顺序有意义：
 *
 * 1. `decodeURIComponent` —— `%2e%2e` 和 `..` 是同一个东西。
 * 2. 必须以 `/` 开头，且不含 `\0`。
 * 3. **任何一段是 `..` 就拒**，不是「先折叠再看结果落在哪」。
 *    `normalize` 对绝对路径会把越界的 `..` 悄悄折回根内——结果确实安全，
 *    但那等于**默认接受一个明显在试图逃逸的请求**，然后靠 404 收场。
 *    真实浏览器发出的 URL 里根本不会有 `..`（它自己先规范化过），
 *    所以见到就是有人在试，明说拒掉比悄悄折回诚实。
 *    判据是**分段**而不是 `includes("..")`：`v1..2` 是个合法目录名。
 * 4. 仍然核一遍前缀。前三道都过了还核，是因为 `join` 的行为随平台变，
 *    而这一道不依赖它——**唯一不能被绕过的那道要放在最后**。
 */
export function safeJoin(root: string, urlPath: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return undefined
  }
  if (!decoded.startsWith("/") || decoded.includes("\0")) return undefined
  if (decoded.split(/[/\\]/).includes("..")) return undefined
  const full = resolve(join(root, normalize(decoded)))
  const base = resolve(root)
  return full === base || full.startsWith(base + sep) ? full : undefined
}

/**
 * 缓存策略：**带内容哈希的资源永久缓存，入口页从不缓存**。
 *
 * 反过来（入口页也缓存）的下场是换了版本的客户端还在跑旧的 JS，
 * 而旧 JS 讲的可能是旧协议——那种错会表现成「界面在，但什么都不动」。
 *
 * ## 判据为什么是「在 /assets 下」+ base64url 字母表
 *
 * 上一版写的是 `[0-9a-f]{8,}`——**十六进制**。而 vite 8 / rolldown 出的哈希是
 * base64url：`index-DRd54R9P.js`、`vendor-BwP_2TDL.js`。六个产物一个都匹配不上，
 * 于是全部落 `no-cache`，vendor 分包在传输上收益为零，手机每次冷启动
 * 在蜂窝网上重下整份。
 *
 * 只放宽字符集不行：那会把 `my-component.js` 也判成永久缓存。所以加一条
 * 「必须在 `/assets/` 下」——那个目录里的东西**按定义**都是带哈希的构建产物。
 */
function cacheFor(urlPath: string, file: string): string {
  const hashed = urlPath.startsWith("/assets/") && /-[A-Za-z0-9_-]{8,}\.(js|css|woff2)$/.test(file)
  return hashed ? "public, max-age=31536000, immutable" : "no-cache"
}

export interface StaticResult {
  ok: boolean
  /** 没送出去时的原因，写日志用。 */
  reason?: string
}

/**
 * 送一个文件。找不到就退回 `index.html`（单页应用的深链要能直接打开）。
 * @param root 站点根目录。不存在时一律 404——**别假装有**。
 */
export async function serveStatic(
  root: string,
  urlPath: string,
  res: ServerResponse,
  req?: IncomingMessage,
): Promise<StaticResult> {
  const target = safeJoin(root, urlPath === "/" ? "/index.html" : urlPath)
  if (target === undefined) {
    res.writeHead(400).end("bad path")
    return { ok: false, reason: `路径越界：${urlPath}` }
  }
  const file = (await isFile(target)) ? target : await fallback(root, urlPath)
  if (file === undefined) {
    res.writeHead(404).end("not found")
    return { ok: false, reason: `找不到：${urlPath}` }
  }
  // **ETag 是兜底。** 上面那条判据再漏一类，最坏也只是退化成 304 而不是全量重传。
  // 用 mtime+size 而不是内容哈希：`stat` 已经拿到了，不必为此把文件读一遍
  const info = await statOf(file)
  const etag = info === undefined ? undefined : `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`
  if (etag !== undefined && req?.headers["if-none-match"] === etag) {
    res.writeHead(304, { etag, "cache-control": cacheFor(urlPath, file) }).end()
    return { ok: true }
  }
  send(res, { file, urlPath, etag, gzip: shouldGzip(req, typeOf(file), info?.size ?? 0) })
  return { ok: true }
}

/**
 * 真正把文件发出去那一段。
 *
 * 从 `serveStatic` 里拆出来是复杂度闸门逼的，但边界也讲得通：
 * 上面那半是**判定**（能不能给、要不要给、给哪个），这半是**投递**。
 */
function send(res: ServerResponse, o: { file: string; urlPath: string; etag?: string; gzip: boolean }): void {
  res.writeHead(200, {
    "content-type": typeOf(o.file),
    "cache-control": cacheFor(o.urlPath, o.file),
    // **压过的要声明 `vary`**，否则中间任何一层缓存都可能把压过的那份
    // 喂给一个不认 gzip 的客户端
    ...(o.gzip ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}),
    ...(o.etag === undefined ? {} : { etag: o.etag }),
    // 页面里不加载任何外部资源；写死这条比事后发现某个依赖偷偷发了请求便宜
    "content-security-policy":
      "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  })
  const stream = createReadStream(o.file)
  // **边压边发**，不落盘、不缓存：这些文件一个版本只发几次，
  // 为它们建一层缓存的复杂度换不来什么
  if (o.gzip) stream.pipe(createGzip()).pipe(res)
  else stream.pipe(res)
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** 文件的大小与修改时间，用来拼 ETag。取不到就不发 ETag（而不是发一个假的）。 */
async function statOf(path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
  try {
    const info = await stat(path)
    return { size: info.size, mtimeMs: Math.floor(info.mtimeMs) }
  } catch {
    return undefined
  }
}

/**
 * 找不到时退回 `index.html`——**只对导航路由，不对资源**。
 *
 * 单页应用的深链（`/?thread=xxx` 那种）要能直接打开，所以未知路径给 index.html。
 * 但 `/assets/` 下的东西**不能这么兜**：那里的文件名带内容哈希，
 * 一次没命中就说明它真的不在了（换了包，而某个客户端手上还是旧的 index.html）。
 * 兜给 index.html 的后果是浏览器拿到一份 `content-type: text/javascript` 的 HTML——
 * **语法错误、整个应用白屏**，而 HTTP 状态码是 200，排查时一眼看不出问题在哪。
 * 老老实实 404，浏览器才会去重新拉一份 index.html。
 */
async function fallback(root: string, urlPath: string): Promise<string | undefined> {
  if (urlPath.startsWith("/assets/")) return undefined
  const index = join(root, "index.html")
  return (await isFile(index)) ? index : undefined
}
