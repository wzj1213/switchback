import { resolve } from "node:path"
import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"

const here = import.meta.dirname

export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve(here, "src/main/index.ts") } },
  },
  preload: {
    build: { rollupOptions: { input: resolve(here, "src/preload/index.ts") } },
  },
  renderer: {
    root: resolve(here, "src/renderer"),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(here, "src/renderer/index.html") } },
  },
})
