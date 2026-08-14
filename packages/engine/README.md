# @omni/engine

把各家原生 agent 翻译成 `@omni/protocol` 的事件模型。每个驱动一个子目录，
对上暴露同一个 `EngineDriver` 契约，对下讲各家自己的协议。

引擎跑自己的原生进程、用自己的鉴权和模型配置。omni 不重写任何一家的循环。

## 拥有什么

- `EngineDriver` / `EngineSession` 契约（`contract.ts`）
- `subprocess.ts` —— 进程组所有权与回收阶梯，各引擎共用
- `claude/` —— Claude Agent SDK 驱动（`@anthropic-ai/claude-agent-sdk`）
  - `permission.ts` 把 SDK 的 `canUseTool` 请求翻成 `@omni/approval` 的 `Request`，
    再把 `Verdict` 翻回 SDK 的 `PermissionResult`
  - `translate.ts` 把 `SDKMessage` 翻成 `Event`
  - `driver.ts` 会话生命周期与进程回收
- `codex/` —— `codex app-server --stdio` 驱动（JSON-RPC 2.0）
  - `rpc.ts` 分帧与请求关联。纯粹字节进字节出，不碰子进程，
    所以没装 codex 的机器上也能跑测试
  - `wire.ts` 线上类型的窄声明（权威定义用 `codex app-server generate-ts` 自己生成）
  - `translate.ts` / `notify.ts` 通知 → 事件
  - `approve.ts` 审批请求 ↔ `@omni/approval`

## 不拥有什么

- **不拥有审批判定**。判定在 `@omni/approval`，本包只做协议翻译与应答。
- 不拥有 UI。需要人工裁决时调 `StartRequest.askUser`，由宿主决定怎么呈现。
- 不拥有持久化。事件流往外发，落盘是 `@omni/journal` 的事。
- 不拥有引擎的安装、登录、模型选择——用宿主上已有的原生配置。

## 两家的结构差别

接第二家才看清的东西，写下来免得下次又当成一样的：

| | Claude Agent SDK | codex app-server |
| --- | --- | --- |
| 审批载荷 | `canUseTool` 带**完整**工具名与参数 | 只带一个 `itemId`，命令和 diff 在此前的 `item/started` 里 |
| 档位落点 | `permissionMode` 只是路由开关，钉死 `default`，档位全在 omni 里 | `sandbox` 是**真的 OS 沙箱**，它同时就是「问不问」的开关，档位必须落在它上面 |
| 谁先放行 | 用户自己写的 allow 规则先于 `canUseTool` | codex 内置的可信命令表先于客户端 |
| 流式增量 | 未接（走整块替换） | 原生给 delta 通知，直接落 `item.delta` |
| 工具语义 | 只有工具名与参数，形态靠我们查表猜 | 附带 `commandActions`，`read` 能直出 `file_read` |

两条被实测证伪的直觉：

1. **「approvalPolicy 调到最严就能把请求全部路由给我」——不成立。**
   `approvalPolicy: untrusted` + `sandbox: workspace-write` 下，往工作区里写文件
   根本不会来问：沙箱本来就允许，codex 没有理由问。换成 `read-only`，同一次写
   立刻变成一条 `item/fileChange/requestApproval`。**沙箱才是那个开关。**
2. **「审批请求里总该说清楚它要干什么」——不成立。** codex 的审批请求是一个
   **指回此前那条 item 的引用**。驱动不留在途 item，就只能问用户
   「要批准这个吗」而说不出「这个」是什么。

## 已知限制

- **Claude 侧只覆盖 `SDKMessage` 联合的一小部分。** 该联合有 38 个成员，
  驱动只翻译 assistant / stream_event / result / system 四类，其余落 `meta` 或丢弃。
  新增覆盖时先确认它是否真的需要进 transcript。
- **codex 侧只消费 74 种通知里的一小撮**：item 生命周期、三种文本 delta、
  `turn/completed`、`error`。命令输出的增量（`item/commandExecution/outputDelta`）
  没接——输出会在 `item/completed` 时一次性到齐，长命令跑着的时候界面上没有滚动。
- **codex 的 OS 沙箱在 `thread/start` 时定死，`setTrust` 改不了它。** 往低调没问题
  （omni 拒得更多），往高调会出现「omni 说可以、写下去却被系统拦住」。
  驱动检测到这种情况会发一条 `engine.status` 说明，但真正生效仍需新开会话。
- **各家自己的放行表都在 omni 之前生效**：Claude 是用户写的 allow 规则，
  codex 是内置可信命令表（`ls`、`sed`、`cat` 这类根本不会送到客户端）。
  这是「引擎原生」这个前提的必然代价——用户的原生配置压过宿主的自动策略。
- 事件流不做背压。宿主必须能消费得比引擎产出快，否则内存增长。
- `acp/` 尚未实现。
