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

## 为什么 desktop 直接依赖了 Claude 的 SDK

`@omni/engine` 是 workspace 源码，会被**打进** main 进程产物。产物因此继承了
engine 的运行时依赖，而 Node 从产物所在目录往上找 `node_modules`——
所以这些依赖必须出现在 app 根目录，否则运行时报 `ERR_MODULE_NOT_FOUND`。
每新增一个引擎驱动，它的运行时依赖都要在这里跟着加一条。

## 已知限制

- **IPC 只做了合帧，没做序号与重放。** 事件流仍然假设有序不丢——
  这在同机 IPC 上成立，但渲染层崩溃重载之后**丢掉的那几条不会补**
  （重载会重新回放磁盘上的历史，所以丢的只是崩溃那一瞬间的增量）。
- 主题只做了浅色 + 跟随系统的深色 token，**没有手动切换**。
- 打出来的包**没有签名与公证**。首次打开要手动放行。
- 应用 576 MB / DMG 208 MB。大头是 Electron 运行时与 Claude SDK 自带的 CLI。
- `⌘F` 查找覆盖**整个窗口**，侧栏预览与查找框自身也算命中——
  排掉它们需要让输入框不可输入，而中文 IME 需要一个真正获得焦点的 input，
  不划算。计数上挂了 tooltip 说明。
