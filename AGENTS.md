# Switchback 工程规范

这份文件必须保持在 **150 行以内**。规则写不进这里，就说明它该写进对应包的 README。

## 硬规则（lint / CI 强制，不是建议）

| 规则 | 阈值 | 强制方式 |
| --- | --- | --- |
| 单文件行数 | **≤ 300**（renderer 组件 ≤ 200） | `eslint max-lines` |
| 单函数行数 | **≤ 60**（renderer 组件 ≤ 100） | `eslint max-lines-per-function` |
| 圈复杂度 | ≤ 12 | `eslint complexity` |
| 嵌套深度 | ≤ 3 | `eslint max-depth` |
| 模块级可变状态 | **禁止**（不得有顶层 `let` / `var`） | `eslint no-restricted-syntax` |
| 跨包深引用 | **禁止**（只能 import 包的入口） | `eslint no-restricted-imports` + 包边界 |
| 未声明依赖 | 禁止 | pnpm workspace + `pnpm arch` |
| 组件用到的 class 没有任何 CSS 规则 | 禁止 | `pnpm check:css` |
| 界面文案写死在代码里 | 禁止：放进同名 `*.messages.ts`，中英两版都写；`i18n-todo.json` 里的旧文件逐步迁 | `pnpm check:i18n` |

提交前 `pnpm check` 必须全绿（typecheck + lint + arch + test）。

**为什么定这些阈值**：上一版（crew）的 `cmd/crewd/chat.go` 长到 9,282 行 / 238 函数，
其中 `runSuperviseFrom` 单函数 466 行；30 个文件同属一个包，靠包级可变全局互相通信。
这些数字不是洁癖，是那次失败的直接对策。

## 包契约

每个 `packages/*` 必须有 `README.md`，且必须包含三节：

```
## 拥有什么
## 不拥有什么
## 已知限制
```

写不出「不拥有什么」的包，就是边界没划对——先别写代码。

**精确依赖边**（`pnpm arch` 校验；依赖增删必须同步改 `scripts/package-graph.mjs`）：

<!-- package-graph:start -->
```text
protocol ← ∅
approval ← i18n + protocol
store ← protocol
wire ← protocol
link ← protocol + wire + i18n
worksite ← ∅
i18n ← ∅
journal ← protocol
handoff ← protocol
engine ← protocol + approval + i18n
host ← protocol + approval + engine + store + journal + handoff + i18n
desktop ← protocol + engine + handoff + host + i18n + journal + link + store + wire + worksite
web ← i18n + link + protocol + store + wire
```
<!-- package-graph:end -->

**纯逻辑包（`protocol` / `approval` / `i18n`）零运行时依赖、零 IO**：不读文件、不发网络、不起进程、
不读时钟（时间由调用方传入）。这是它们能被表驱动测试穷举的前提。

## 产品边界

**总纲：Switchback 与引擎是共建者，不是上下级。** 下面每一条都是它的推论；
遇到本节没写到的新情况，用它裁决。判据是一句话：**这件事是引擎自己把它当功能暴露出来的，
还是 Switchback 拿它的零件替它攒出来的？** 后者一律不做——哪怕零件够得着、哪怕体验更好。

由此定死三条最容易越界的：**不往模型的上下文里塞 Switchback 写的话**（提示词、边界声明、
"你还有几步没做"的提醒，一概不塞；照抄厂商原文也算塞）；**不替引擎改它自己的行为**
（不注入开关某个工具的环境变量，不为某一轮单方面收紧用户选定的档位）；
**不给引擎自报的状态叠 Switchback 的猜测**（它报错了就是报错了，分辨不出就如实记下、写进已知限制，
不加私有判据去纠正它）。

第一条**只有一个例外：换引擎自动交接**（设置里看得见、关得掉，默认开）。换家后的第一句话前
附一段只陈述事实的说明——此前谁跑了哪几轮、Switchback 整理的转写与各段原始记录在哪、那些记录
实际是什么格式（现读现报，不维护格式说明）；不下任务、不评价、不催进度，原样显示在转录区。
它就是下面「给路径，让它自己读」的自动化。要往模型上下文里加任何别的话，先改这一段。

**外发守卫不算「替引擎改行为」，但只许做两件事：看、停**（`main/egress-guard.ts`，设置里关得掉）。
看的是系统记的每进程外部流量，引擎**自己**一分钟外发超过 64 MB 就停掉它、说清楚为什么；
不改它的配置、不注入环境变量、不代理或拦截它的请求。ZCode 快照目录上锁同理：动的是它落盘的目录，不是它的进程。

一条能力"没从它的对外那扇门出来"，结论就是**这条路不通**，不是"这家弱、Switchback 来补"。
补上的那一刻，Switchback 就得为一个自己没有能力维护的东西负责：厂商改了实现不会通知你，
而用户看到的是 Switchback 在撒谎。

- **GUI 优先。不做面向用户的 CLI。** 命令行只保留 `apps/desktop` 的开发调试入口。
- 引擎跑自己的原生进程，用自己的鉴权、模型和配置。Switchback 不重写任何一家的能力。
- Switchback 不调用 LLM API。模型由各引擎自己管。
- 不做多 agent 编排。跨引擎只有两个动作：**接力**（handoff）与**换一家再试**。
- **不发明 agent 之间的协议。** 让 A 去评审 B 的改动这类需求，一律走「**给路径，让它自己读**」——
  每一家都有文件工具，而 Switchback 存着每一段的原始记录（`Thread.segments` 的 `logPath`）。
  自制一套「A 把 diff 递给 B、B 把结论递回来」的交互，是这个产品最容易陷进去的坑：
  它要定消息格式、定谁等谁、定失败了算谁的，而这些每加一家引擎就要重谈一次。

## 两条日志线（强制）

| 文件 | 面向 | 何时写 |
| --- | --- | --- |
| `更新日志.md`（根目录） | **使用者** | 每个**用户可见**的特性/改动，顶部新增一条 |
| `docs/工程时间线.md` | dev | 每次架构决策、依赖变更、批量重构 |

`更新日志.md` 格式固定（`pnpm check:docs` 校验）：

```
## 标题 · YYYY-MM-DD
- 做了什么：
- 收获：
- 如何使用：
```

最新在上。**写给使用者看，别堆技术细节**——技术细节属于 `docs/工程时间线.md`，
那里可以附验证计数（`✅ typecheck / lint / arch / test`）。
将来 `更新日志.md` 由桌面端侧栏「时间线」视图渲染，是「能用什么、怎么用」的单一来源。

## 提交

Conventional Commits，**英文摘要**：`type(scope): summary`（2026-10-23 起；之前的历史是中文，不改）。
摘要写给仓库外的读者：说这次改动带来了什么，不写过程细节；为什么这么改写在正文里。

## 命名

- 包名 `@switchback/<name>`，目录名与包名后缀一致。
- 文件名 kebab-case，类型文件 `types.ts`，入口 `index.ts`。
- `index.ts` 只做 re-export，不写逻辑。

## 测试

- 单元测试与源码同目录：`src/foo.ts` → `src/foo.test.ts`。
- 纯逻辑包用**表驱动测试**：一张 case 表，一个循环，不要为每个 case 写一个 `it`。
- 需要真实引擎进程的测试标 `*.live.test.ts`，默认不跑（`vitest run` 排除）。

## 反模式（出现即视为 bug）

1. 在 `index.ts` 里写逻辑
2. 用模块级 `let` 缓存状态（要缓存就显式传一个 store 进来）
3. 在纯逻辑包里 `import fs` / `Date.now()` / `process.env`
4. 一个函数同时做「推进状态」和「持久化」和「发通知」
5. 往 `AGENTS.md` 里加规则而不是往包 README 里加
