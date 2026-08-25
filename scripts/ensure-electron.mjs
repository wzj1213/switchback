#!/usr/bin/env node
/**
 * Electron 43 在首次 require 时才下载运行时。Vitest 的 worker 若同时首次导入，
 * 会并发解压同一份 Electron.app；测试启动前从 desktop 包上下文串行解析一次即可。
 */
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const requireFromDesktop = createRequire(join(ROOT, "apps/desktop/package.json"))

requireFromDesktop("electron")
