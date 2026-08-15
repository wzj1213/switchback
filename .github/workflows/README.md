# CI

只有一条流水线：`check.yml`，跑 `pnpm check` ＋ 一次真实构建。

**为什么在 macOS 上跑**：进程回收阶梯依赖 `kill(-pid, 0)` 的进程组语义，
而这个产品的目标平台就是 macOS。在 Linux 上跑绿了不说明在这儿也绿。

**为什么构建要单独跑一次**：打包器能发现类型检查发现不了的问题。真踩过——
`highlight.js` 是 `lowlight` 的传递依赖，`tsc` 全绿，`electron-vite build`
才报 `failed to resolve import`。

**为什么不跑 live 测试**：`*.live.test.ts` 需要机器上装好并登录过 codex / Claude。
CI 上没有那些凭据，跑了只会得到一片必然的红。它们的入口是 `pnpm test:live`，
改引擎驱动时在本地手动执行。
