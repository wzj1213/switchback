import { describe, expect, it } from "vitest"
import { safeJoin } from "./static.js"

const ROOT = "/srv/omni/web"

describe("路径穿越", () => {
  const allowed: readonly [string, string][] = [
    ["/index.html", "/srv/omni/web/index.html"],
    ["/assets/app-1a2b3c4d.js", "/srv/omni/web/assets/app-1a2b3c4d.js"],
    ["/./index.html", "/srv/omni/web/index.html"],
  ]
  for (const [urlPath, expected] of allowed) {
    it(`放行 ${urlPath}`, () => {
      expect(safeJoin(ROOT, urlPath)).toBe(expected)
    })
  }

  const blocked: readonly [string, string][] = [
    ["上一层", "/../secrets"],
    ["爬到家目录", "/../../../../etc/passwd"],
    ["**百分号编码的点点**", "/%2e%2e/%2e%2e/etc/passwd"],
    ["双重编码的斜杠", "/..%2fetc%2fpasswd"],
    ["空字节截断", "/index.html%00.png"],
    ["坏的百分号编码", "/%zz"],
    ["**前缀撞名的兄弟目录**", "/../web-secrets/key"],
    ["反斜杠分段（Windows 上 `..\\` 也是穿越）", "/..\\secrets"],
    ["夹在中间的一段", "/assets/../../etc/passwd"],
    ["不以 / 开头（畸形请求行）", "assets/app.js"],
  ]
  for (const [why, urlPath] of blocked) {
    it(`拒 ${why}（${urlPath}）`, () => {
      expect(safeJoin(ROOT, urlPath)).toBeUndefined()
    })
  }

  it("根目录本身算在内", () => {
    expect(safeJoin(ROOT, "/")).toBe("/srv/omni/web")
  })

  it("**判据是解析后的前缀，不是字符串里有没有 `..`**——正常路径里也可以有两个点", () => {
    expect(safeJoin(ROOT, "/assets/v1..2/app.js")).toBe("/srv/omni/web/assets/v1..2/app.js")
  })
})
