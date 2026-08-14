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

export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve(here, "src/main/index.ts"), external } },
  },
  preload: {
    build: { rollupOptions: { input: resolve(here, "src/preload/index.ts"), external } },
  },
  renderer: {
    root: resolve(here, "src/renderer"),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(here, "src/renderer/index.html") } },
  },
})
