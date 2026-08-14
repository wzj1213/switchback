# omni 工程规范

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

**依赖方向**（`pnpm arch` 校验，不允许成环）：

```
protocol  ← 零依赖，纯类型
approval  ← 只依赖 protocol，纯函数、零 IO
engine    ← 依赖 protocol + approval
worksite  ← 只依赖 protocol
journal   ← 只依赖 protocol
handoff   ← 依赖 protocol
host      ← 依赖以上全部（唯一允许做编排的地方）
desktop   ← 只依赖 host + protocol
```

**纯逻辑包（`protocol` / `approval`）零运行时依赖、零 IO**：不读文件、不发网络、不起进程、
不读时钟（时间由调用方传入）。这是它们能被表驱动测试穷举的前提。

## 产品边界

- **GUI 优先。不做面向用户的 CLI。** 命令行只保留 `apps/desktop` 的开发调试入口。
- 引擎跑自己的原生进程，用自己的鉴权、模型和配置。omni 不重写任何一家的能力。
- omni 不调用 LLM API。模型由各引擎自己管。
- 不做多 agent 编排。跨引擎只有两个动作：**接力**（handoff）与**换一家再试**。

## 两条日志线（强制）

| 文件 | 面向 | 何时写 |
| --- | --- | --- |
| `更新日志.md`（根目录） | **使用者** | 每个**用户可见**的特性/改动，顶部新增一条 |
| `docs/工程时间线.md` | dev | 每次架构决策、依赖变更、批量重构 |

`更新日志.md` 格式固定（`pnpm docs` 校验）：

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

Conventional Commits，中文摘要：`type(scope): 摘要`。
提交前先看最近几条提交的风格，不用裸英文句子。

## 命名

- 包名 `@omni/<name>`，目录名与包名后缀一致。
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
