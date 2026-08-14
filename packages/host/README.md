# @omni/host

会话编制与进程生命周期。**唯一允许做编排的地方**——其余包都只做一件窄事。

宿主拥有 thread / turn 的身份，引擎拥有 item 的身份。这条分工是有意的：
prompt 是宿主发出的，所以宿主知道一轮什么时候开始；引擎知道自己产出了什么，
所以 item 由它铸造 id。`turn.completed` 由引擎发（只有它知道自己什么时候真收工）。

## 拥有什么

- `createHost(deps)` —— 命令分发（`Command` → 引擎）与事件汇聚（引擎 → `Event`）
- 会话注册表：thread id → 活着的 `EngineSession`
- 审批闸（`gate.ts`）：把驱动的 `askUser` 变成一张 transcript 里的审批卡，
  等渲染层的 `approval.resolve` 命令来落定
- 处置：`dispose()` 关掉全部会话，并把还挂着的审批**按拒绝 settle**

## 不拥有什么

- **不拥有审批判定**。判定在 `@omni/approval`，宿主只负责把「需要人」这件事送到界面。
- 不拥有引擎协议。各家的握手与消息翻译在 `@omni/engine`。
- 不拥有视图状态。归约在 `@omni/store`，宿主只发事件。
- 不拥有 UI、IPC 传输、持久化。

## 已知限制

- **不做背压**。`emit` 必须同步返回得比引擎产出快，否则事件在内存里堆积。
- **进程回收只到 `session.dispose()` 为止**，而 Claude 驱动的 dispose 只有
  `interrupt()` + `AbortController`，没有 SIGTERM→SIGKILL→整树退出证明的阶梯。
  接第二个引擎前必须补，否则会泄漏引擎子进程。
- 未接持久化：进程重启后会话全丢。
- `thread.handoff`（跨引擎接力）尚未实现，命令会被拒绝。
