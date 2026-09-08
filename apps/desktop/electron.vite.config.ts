import { builtinModules } from "node:module"
import { resolve } from "node:path"
import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"

const here = import.meta.dirname

/**
 * main / preload 不能打包这些。
 *
 * `electron` 尤其关键：npm 上的 `electron` 包是个**返回二进制路径的 CLI 壳**，
 * 把它打进产物会让 `import { app } from "electron"` 解析到那个壳，
 * 运行时报 "Electron failed to install correctly"。真正的 `electron` 模块
 * 由 Electron 运行时在进程内注入，必须留成 external。
 *
 * Claude Agent SDK 同理：它要 spawn 自带的 CLI，打包会打断它找自己的资源。
 */
const external = [
  "electron",
  "@anthropic-ai/claude-agent-sdk",
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]

/**
 * 进 `vendor` 块的包名，**按 npm 包名精确列举**。
 *
 * 收的是「又大又几乎不动」的渲染管线——Markdown 那一串解析器。
 * 只有工作区代码**直接 import** 的包需要列：它们私有的传递依赖
 * （字符表、各种 util）只被这些包引用，rollup 的块着色会自动跟着进来。
 *
 * 为什么值得分：接 react-markdown 之后渲染层从 504 KB 涨到 1,066 KB，
 * 全都挤在一个块里——**改一行界面代码，整整 1 MB 的哈希全变**，
 * 用户每次更新都要重下。拆开之后改界面只重下 index，vendor 命中缓存。
 *
 * ⚠️ **成员必须与 React 无关。** rollup 会把「入口与手工块共享的模块」
 * 折进手工块里；只要有一个成员 import 了 react，那份唯一的 react 就会被
 * 拖进 vendor，两个块都得重下，白拆。这条规则借自 dsh 的 apps/web。
 */
const VENDOR: ReadonlySet<string> = new Set([
  "react-markdown",
  "remark-gfm",
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
  // 语法高亮：hljs 的语法定义又大又几乎不动，正是该进 vendor 的东西
  "lowlight",
  "highlight.js",
])

/**
 * 解析出模块所属的 npm 包名：最后一个 `node_modules/` 之后的那一段。
 * pnpm 会把真实包再嵌一层 node_modules，所以取最后一段而不是第一段；
 * `.pnpm` 那种以点开头的是仓库目录，不是包。
 */
function npmPackageOf(id: string): string | undefined {
  const parts = id.split("/node_modules/")
  if (parts.length === 1) return undefined
  const [first, second] = (parts[parts.length - 1] ?? "").split("/")
  if (first === undefined || first.startsWith(".")) return undefined
  if (first.startsWith("@")) return second === undefined ? undefined : `${first}/${second}`
  return first
}

/** 前缀命中也算：micromark-util-* / mdast-util-* 有几十个小包，逐个列没有意义。 */
function inVendor(pkg: string): boolean {
  if (VENDOR.has(pkg)) return true
  return ["micromark-", "mdast-util-", "unist-util-", "hast-util-"].some((p) => pkg.startsWith(p))
}

export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve(here, "src/main/index.ts"), external } },
  },
  preload: {
    // sandbox preload 由 Electron 当普通脚本加载，没有 ESM loader；显式产出 CJS。
    build: {
      rollupOptions: {
        input: resolve(here, "src/preload/index.ts"),
        external,
        output: { format: "cjs" },
      },
    },
  },
  renderer: {
    root: resolve(here, "src/renderer"),
    plugins: [react()],
    build: {
      // electron-vite 默认关闭压缩；生产包也需要减少解析与编译成本。
      minify: true,
      rollupOptions: {
        input: resolve(here, "src/renderer/index.html"),
        output: {
          manualChunks: (id: string): string | undefined => {
            const pkg = npmPackageOf(id)
            // 工作区代码与 react 一族留在默认的 index 块
            return pkg !== undefined && inVendor(pkg) ? "vendor" : undefined
          },
        },
      },
    },
  },
})
