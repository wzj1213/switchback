# omni · 同文

> 一个界面，统一驱动各家原生 coding agent。

切引擎，不换习惯。codex / claude code / zcode / kimi 各自跑自己的原生进程、用自己的鉴权和模型，
omni 只负责把它们呈现成同一套交互，并让你**随时在它们之间切换、甚至中途接力**。

名字取自「书同文」——多家写法，一个标准。

## 这是什么 / 不是什么

**是**：一个 GUI。会话、审批、diff、终端、项目、断点续跑、跨引擎接力。

**不是**：

- 不是 CLI 工具（命令行只有开发调试入口）
- 不是 agent harness —— 不重写任何一家的循环、提示词或工具
- 不调用 LLM API —— 模型由各引擎自己管
- 不做多 agent 编排 —— 跨引擎只有两个动作：**接力**与**换一家再试**

## 切换的三层

| 层 | 含义 |
| --- | --- |
| L1 | 新会话选引擎 |
| L2 | **同会话中途换引擎接力**（差异化所在） |
| L3 | 同任务换一家再跑，两个结果并排 |

L2 不传原始上下文（各家 session 格式不通），传**交接包**：目标 + 已确认事实 +
工作区状态 + 未完成项 + 关键决策。

## 结构

```
packages/
  protocol/   领域模型 thread / turn / item（零依赖，纯类型）
  approval/   信任档 + 红线表 + 判定器（纯函数，零 IO）
  engine/     引擎驱动契约与实现：acp / codex / claude
  worksite/   工作区安全：git guard、写范围
  journal/    持久化、断点、恢复
  handoff/    跨引擎交接包
  host/       会话编制与进程生命周期（唯一允许做编排的地方）
apps/
  desktop/    Electron 壳 + React 渲染层
```

依赖方向由 `pnpm arch` 强制，不允许回流或成环。

## 开发

```sh
pnpm install
pnpm check     # typecheck + lint + arch + test，提交前必须全绿
pnpm dev       # 起桌面端
pnpm test:watch
```

工程规范见 [`AGENTS.md`](AGENTS.md)（强制保持 150 行以内）。

## 上一版的教训

omni 是 `crew` 的重定位重写。crew 的问题不是选错框架，是定位没收住 + 没有模块边界：
`cmd/crewd/chat.go` 长到 9,282 行 / 238 函数、30 个文件同属一个包、根目录堆了 15 万字节规则文档，
而产品把原生 agent 包在一层约束里，实测效果反而不如直接用 codex。

omni 的对策写死在 `AGENTS.md` 的硬规则和 `scripts/check-arch.mjs` 里——**是 lint 和 CI 在挡，不是纪律在挡**。
