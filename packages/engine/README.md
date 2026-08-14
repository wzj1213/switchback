# @omni/engine

把各家原生 agent 翻译成 `@omni/protocol` 的事件模型。每个驱动一个子目录，
对上暴露同一个 `EngineDriver` 契约，对下讲各家自己的协议。

引擎跑自己的原生进程、用自己的鉴权和模型配置。omni 不重写任何一家的循环。

## 拥有什么

- `EngineDriver` / `EngineSession` 契约（`contract.ts`）
- `claude/` —— Claude Agent SDK 驱动（`@anthropic-ai/claude-agent-sdk`）
  - `permission.ts` 把 SDK 的 `canUseTool` 请求翻成 `@omni/approval` 的 `Request`，
    再把 `Verdict` 翻回 SDK 的 `PermissionResult`
  - `translate.ts` 把 `SDKMessage` 翻成 `Event`
  - `driver.ts` 会话生命周期与进程回收

## 不拥有什么

- **不拥有审批判定**。判定在 `@omni/approval`，本包只做协议翻译与应答。
- 不拥有 UI。需要人工裁决时调 `StartRequest.askUser`，由宿主决定怎么呈现。
- 不拥有持久化。事件流往外发，落盘是 `@omni/journal` 的事。
- 不拥有引擎的安装、登录、模型选择——用宿主上已有的原生配置。

## 已知限制

- **Claude 侧只覆盖 `SDKMessage` 联合的一小部分。** 该联合有 38 个成员，
  驱动只翻译 assistant / stream_event / result / system 四类，其余落 `meta` 或丢弃。
  新增覆盖时先确认它是否真的需要进 transcript。
- 事件流不做背压。宿主必须能消费得比引擎产出快，否则内存增长。
- 进程回收依赖 SDK 的 `query.interrupt()` 与 `AbortController`；
  尚未实现 DSH 那种「EOF grace → SIGTERM → SIGKILL → 等待整树退出」阶梯，
  引擎子进程理论上可能泄漏。接第二个引擎前必须补上。
- `codex/` 与 `acp/` 尚未实现。
