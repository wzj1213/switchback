# @omni/engine

把各家原生 agent 翻译成 `@omni/protocol` 的事件模型。每个驱动一个子目录，
对上暴露同一个 `EngineDriver` 契约，对下讲各家自己的协议。

引擎跑自己的原生进程、用自己的鉴权和模型配置。omni 不重写任何一家的循环。

## 拥有什么

- `EngineDriver` / `EngineSession` 契约（`contract.ts`）
- `subprocess.ts` —— 进程组所有权与回收阶梯，各引擎共用
- `rpc.ts` —— JSON-RPC 2.0 over 换行分隔 JSON。**codex 与 ACP 共用一份**：
  接 ACP 时这个文件从 `codex/` 提到包根，一个字没改就跑通了
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
- `acp/` —— 通用 ACP over stdio 驱动（Agent Client Protocol）
  - **一个驱动接所有讲 ACP 的引擎**。前两家各写一个驱动，第 N 家不该再写第 N 个
  - `wire.ts` 线上类型的窄声明（权威定义：`npm pack @agentclientprotocol/sdk`）
  - `update.ts` `session/update` → 事件，含**文本块划分**（见下）
  - `translate.ts` 工具形态与停止原因
  - `setup.ts` 从 `session/new` 里挖模型与档位（两代适配器字段名不同）
  - `mode.ts` 信任档 → agent 自己定义的 mode，**打分匹配**
  - `permission.ts` / `approve.ts` 审批判定与选项挑选

## 不拥有什么

- **不拥有审批判定**。判定在 `@omni/approval`，本包只做协议翻译与应答。
- 不拥有 UI。需要人工裁决时调 `StartRequest.askUser`，由宿主决定怎么呈现。
- 不拥有持久化。事件流往外发，落盘是 `@omni/journal` 的事。
- 不拥有引擎的安装、登录、模型选择——用宿主上已有的原生配置。

## 三家的结构差别

接第二家、第三家才看清的东西，写下来免得下次又当成一样的：

| | Claude Agent SDK | codex app-server | ACP |
| --- | --- | --- | --- |
| 审批载荷 | `canUseTool` 带**完整**工具名与参数 | 只带一个 `itemId`，命令和 diff 在此前的 `item/started` 里 | 只带 `toolCallId` + kind + status，同样要查在途表 |
| 怎么回审批 | allow / deny | 固定枚举 `accept` / `decline` / `acceptForSession` | **agent 自己给的一张选项表**，按不透明的 `optionId` 回 |
| 档位落点 | `permissionMode` 只是路由开关，钉死 `default`，档位全在 omni 里 | `sandbox` 是**真的 OS 沙箱**，它同时就是「问不问」的开关 | `session/set_mode`，但 mode 是 **agent 自定义字符串**，只能打分匹配 |
| 谁先放行 | 用户自己写的 allow 规则先于 `canUseTool` | codex 内置的可信命令表先于客户端 | 同 codex（多数 ACP agent 就是包了一层原生 CLI） |
| 文本身份 | 整块消息，一条就是一条 | `item/started` 铸 id → delta → `item/completed` | **一串裸 chunk，没有 id、没有开始、没有结束** |
| 工具身份 | 工具名 | item 的 `type` + `commandActions` | 只有 `kind`（`read`/`edit`/`execute`/…），**没有工具名这个字段** |
| 推理强度 | `Options` 字段，改不了运行期 | 独立的 `reasoningEffort` | **编在 modelId 里**（`gpt-5.6-sol[low]`），没有独立字段 |

三条被实测证伪的直觉，都写在各自的 `driver.ts` 顶上：

1. **「approvalPolicy 调到最严就能把请求全部路由给我」——不成立。**
   `approvalPolicy: untrusted` + `sandbox: workspace-write` 下，往工作区里写文件
   根本不会来问：沙箱本来就允许，codex 没有理由问。**沙箱才是那个开关。**
   ACP 侧同一个实验：`agent` 档下 curl 外网被自己的沙箱拦下并报失败，
   **一次 `session/request_permission` 都没发**；换 `read-only` 档，改文件立刻变成审批请求。
2. **「审批请求里总该说清楚它要干什么」——不成立。** codex 和 ACP 的审批请求都是
   **指回此前那条通知的引用**。驱动不留在途表，就只能问用户「要批准这个吗」
   而说不出「这个」是什么。
3. **「同一个适配器的两个版本，字段名总是一样的」——不成立。** codex-acp 0.16.0 报
   `configOptions[id="model"]`，1.3.0 报 `models.availableModels`。只认一条，
   另一个版本的用户就一个模型都选不出来。

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
- **codex 侧只消费 74 种通知里的一小撮**：item 生命周期、文本与命令输出的 delta、
  用量、`turn/completed`、`error`。其余（MCP 进度、审批复核、实时语音…）一律丢弃。
- **codex 的 OS 沙箱在 `thread/start` 时定死，`setTrust` 改不了它。** 往低调没问题
  （omni 拒得更多），往高调会出现「omni 说可以、写下去却被系统拦住」。
  驱动检测到这种情况会发一条 `engine.status` 说明，但真正生效仍需新开会话。
- **各家自己的放行表都在 omni 之前生效**：Claude 是用户写的 allow 规则，
  codex 是内置可信命令表（`ls`、`sed`、`cat` 这类根本不会送到客户端）。
  这是「引擎原生」这个前提的必然代价——用户的原生配置压过宿主的自动策略。
- 事件流不做背压。宿主必须能消费得比引擎产出快，否则内存增长
  （渲染层那一侧已经在主进程做了合帧，见 `apps/desktop/src/main/batch.ts`）。
- **Claude 的推理强度改不了运行期**：`effort` 是 `query()` 的 `Options` 字段，
  SDK 没有 setter。所以 Claude 驱动不上报 `efforts`，界面上也就不显示那个控件。
- **ACP 侧只消费一小撮 `session/update` 类型**：文本 / 思考 / 工具 / 计划 / 用量 / 换档。
  其余（`session_info_update`、`config_option_update`、`available_commands_update`…）一律丢弃。
- **omni 不认领 ACP 的 `fs/*` 与 `terminal/*`**。`fs` 的用处是让 agent 看见编辑器里
  没存盘的缓冲区——omni 没有编辑器；`terminal` 认领了就等于命令跑在 omni 进程里，
  和「引擎跑自己的原生进程与沙箱」这个前提直接冲突。实测不认领也拿得到命令输出
  （从 `rawOutput.formatted_output`）。
- **ACP 的 mode 是 agent 自定义字符串，omni 的信任档只能打分匹配**（`acp/mode.ts`）。
  匹配不上就保持 agent 默认档并报一条 `engine.status`——硬塞一个猜的 mode，
  塞错方向就是悄悄放开了权限。
- **ACP 的一条消息是我们「划」出来的**。协议只给裸 chunk，连 `messageId` 都没有。
  连续同类算一条，被工具调用或换类打断就收口。这段划分在 `acp/update.ts`。
