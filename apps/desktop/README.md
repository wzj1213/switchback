# @omni/desktop

Electron 壳 + React 渲染层。**这是 omni 唯一的用户界面**——没有面向用户的 CLI。

三个进程角色：

| 角色 | 职责 |
| --- | --- |
| `src/main` | 起窗口；将来在这里跑 `@omni/host`，引擎子进程住在这一侧 |
| `src/preload` | 只暴露一条窄通道：渲染层发 `Command`，接收 `Event` |
| `src/renderer` | 只认 `@omni/protocol` 的事件模型，不知道任何一家引擎的存在 |

## 拥有什么

- 窗口生命周期、菜单、主题
- 渲染层：会话列表、transcript、审批卡、composer
- `Command` / `Event` 的 IPC 传输

## 不拥有什么

- **不拥有引擎驱动**。渲染层不 spawn 进程、不解析任何一家的协议。
- 不拥有审批判定。判定在 `@omni/approval`，这里只渲染 `escalate` 出来的卡片。
- 不拥有持久化。落盘在 `@omni/journal`。
- 不拥有业务编排。跨会话、跨引擎的编制在 `@omni/host`。

## 已知限制

- 当前 `src/main` 还没接 `@omni/host`，渲染层跑的是 `demo.ts` 里的静态数据。
  它的作用是**证明 `@omni/protocol` 的模型足以驱动 UI**——接引擎前先把这条验证掉。
- IPC 尚未做背压与序号。事件流假设有序不丢，接真引擎前必须补。
- 主题只做了浅色 + 跟随系统的深色 token，尚未做主题切换 UI。
