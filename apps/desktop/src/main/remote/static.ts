import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { join, normalize, resolve, sep } from "node:path"
import type { ServerResponse } from "node:http"

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
 */
function cacheFor(path: string): string {
  return /-[0-9a-f]{8,}\.(js|css|woff2)$/i.test(path) ? "public, max-age=31536000, immutable" : "no-cache"
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
export async function serveStatic(root: string, urlPath: string, res: ServerResponse): Promise<StaticResult> {
  const target = safeJoin(root, urlPath === "/" ? "/index.html" : urlPath)
  if (target === undefined) {
    res.writeHead(400).end("bad path")
    return { ok: false, reason: `路径越界：${urlPath}` }
  }
  const file = (await isFile(target)) ? target : await fallback(root)
  if (file === undefined) {
    res.writeHead(404).end("not found")
    return { ok: false, reason: `找不到：${urlPath}` }
  }
  res.writeHead(200, {
    "content-type": typeOf(file),
    "cache-control": cacheFor(file),
    // 页面里不加载任何外部资源；写死这条比事后发现某个依赖偷偷发了请求便宜
    "content-security-policy":
      "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  })
  createReadStream(file).pipe(res)
  return { ok: true }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function fallback(root: string): Promise<string | undefined> {
  const index = join(root, "index.html")
  return (await isFile(index)) ? index : undefined
}
