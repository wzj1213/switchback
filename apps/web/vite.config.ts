import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

/**
 * 浏览器端的构建。产物给主进程的静态服务用（`main/remote/static.ts`）。
 *
 * **分包的理由和桌面端那份一样**：Markdown 那一串解析器又大又几乎不动，
 * 混在一起的话改一行界面代码，整包哈希全变——而这一端的用户很可能在
 * 蜂窝网上重下。拆开之后改界面只重下 index，vendor 命中缓存。
 *
 * ⚠️ vendor 成员必须与 React 无关：rollup 会把「入口与手工块共享的模块」
 * 折进手工块，只要有一个成员 import 了 react，那份唯一的 react 就会被拖进 vendor，
 * 两个块都得重下，白拆。
 */
const VENDOR: ReadonlySet<string> = new Set([
  "react-markdown",
  "remark-gfm",
  "remark-cjk-friendly",
  "remark-parse",
  "remark-rehype",
  "rehype-react",
  "unified",
  "mdast-util-from-markdown",
  "mdast-util-gfm",
  "mdast-util-to-hast",
  "micromark",
  "micromark-core-commonmark",
  "micromark-extension-gfm",
])

function npmPackageOf(id: string): string | undefined {
  const parts = id.split("/node_modules/")
  if (parts.length === 1) return undefined
  const [first, second] = (parts[parts.length - 1] ?? "").split("/")
  if (first === undefined || first.startsWith(".")) return undefined
  if (first.startsWith("@")) return second === undefined ? undefined : `${first}/${second}`
  return first
}

function inVendor(pkg: string): boolean {
  if (VENDOR.has(pkg)) return true
  return ["micromark-", "mdast-util-", "unist-util-", "hast-util-"].some((p) => pkg.startsWith(p))
}

export default defineConfig({
  plugins: [react()],
  build: {
    // 产物要能被 `main/remote/static.ts` 直接当站点根目录送
    outDir: "dist",
    emptyOutDir: true,
    // 手机上打开一个报错的页面，看不到 devtools——把 sourcemap 打进去，
    // 至少远程调试时栈是可读的
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: (id: string): string | undefined => {
          const pkg = npmPackageOf(id)
          return pkg !== undefined && inVendor(pkg) ? "vendor" : undefined
        },
      },
    },
  },
  server: {
    // 开发时把 API 与 WebSocket 转给主进程那侧的服务端
    proxy: {
      "/api": { target: "http://127.0.0.1:17800", ws: true, changeOrigin: false },
    },
  },
})
