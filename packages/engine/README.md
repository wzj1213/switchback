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
  - `trust.ts` 把三档落到 Claude 原生 Plan / Auto / Bypass；进入 Bypass 时显式带 SDK 安全开关
  - `executable.ts` 区分完整版的 SDK 内置 CLI 与轻量版的系统 `claude`，并保持各自探测语义
  - `translate.ts` 把 `SDKMessage` 翻成 `Event`
  - `driver.ts` 会话生命周期与进程回收
- `codex/` —— `codex app-server --stdio` 驱动（JSON-RPC 2.0）
  - `rpc.ts` 分帧与请求关联。纯粹字节进字节出，不碰子进程，
    所以没装 codex 的机器上也能跑测试
  - `wire.ts` 线上类型的窄声明（权威定义用 `codex app-server generate-ts` 自己生成）
  - `translate.ts` / `notify.ts` 通知 → 事件
  - `approve.ts` 审批请求 ↔ `@omni/approval`
  - 任意信任档切换时返回“需重启”，由宿主续接同一 native thread 重建原生沙箱与评审器
- `kimi/` —— `kimi web` 驱动（本机 bearer REST + WebSocket）
  - `server.ts` 只接 loopback 地址，一份私有服务由活跃 Kimi 会话共享，最后一条释放时回收
  - `http.ts` / `stream.ts` 负责原生 envelope、游标补发、断线快照恢复
  - `session.ts` 接会话、审批、模型、档位、历史、侧问与归档；`prompt.ts` 接普通提示与插话
  - `skill.ts` 只投影 Kimi 上报的可激活 skill，并通过公开 `:activate` 入口执行
  - `wire.ts` 是 Kimi 服务自己公开的 OpenAPI / AsyncAPI 的窄声明
  - `log.ts` 只负责定位 Kimi 保存的全量 `wire.jsonl`，供跨引擎接力引用
- `acp/` —— 通用 ACP over stdio 驱动（Agent Client Protocol）
  - **一个驱动接所有只从 ACP 出线的引擎**；Grok、DSH 与用户自配引擎共用
  - `wire.ts` 线上类型的窄声明（权威定义：`npm pack @agentclientprotocol/sdk`）
  - `update.ts` `session/update` → 事件，含**文本块划分**（见下）
  - `translate.ts` 工具形态与停止原因
  - `setup.ts` 从 `session/new` 里挖模型与档位（两代适配器字段名不同）
  - `mode.ts` 信任档 → agent 自己定义的 mode，**打分匹配**
  - `permission.ts` / `approve.ts` 审批判定与选项挑选
  - `grok.ts` 负责它的会话记录路径；`kimi.ts` 仅是废弃 ACP 链路的兼容重导出。
    内置 Kimi 不再注册 `kimi acp`，Kimi 的日志定位归 `kimi/log.ts`

## 不拥有什么

- **不拥有审批判定**。判定在 `@omni/approval`，本包只做协议翻译与应答。
- 不拥有 UI。需要人工裁决时调 `StartRequest.askUser`，由宿主决定怎么呈现。
- 不拥有持久化。事件流往外发，落盘是 `@omni/journal` 的事。
- 不拥有引擎的安装、登录、模型选择——用宿主上已有的原生配置。

## 四条链路的结构差别

接到第四条协议链才看清的东西，写下来免得下次又当成一样的：

| | Claude Agent SDK | codex app-server | Kimi Web | ACP |
| --- | --- | --- | --- | --- |
| 审批载荷 | `canUseTool` 带**完整**工具名与参数 | 只带 `itemId`，命令和 diff 在此前的 item 里 | 请求前就带工具名、action 与完整 display | 只带 `toolCallId` + kind + status，同样要查在途表 |
| 怎么回审批 | allow / deny | `accept` / `decline` / `acceptForSession` | `approved` / `rejected`，可记到 session | **agent 自己给的一张选项表**，按不透明 `optionId` 回 |
| 档位落点 | `permissionMode`：`plan` / `auto` / `bypassPermissions`；未被原生模式结算的请求才走 `canUseTool` | `sandbox` + `approvalPolicy` + `approvalsReviewer`；`auto_review` 才是 “Approve for me” | `permission_mode` + `plan_mode`，可写也可读回 | 通用路径是 `session/set_mode`；Grok 1.0.5 的审批另走 `_meta.autoMode` / `yoloMode` |
| 文本身份 | 整块消息 | item 生命周期 + delta | 原生 turn / step / frame + delta | **一串裸 chunk，没有 id、没有开始、没有结束** |
| 工具身份 | 工具名 | item `type` + `commandActions` | `toolCallId` + 名字 + args + display | 只有短枚举 `kind`，**没有工具名字段** |
| 推理强度 | `Options` 字段，改不了运行期 | 独立 `reasoningEffort` | 每模型 `support_efforts`，运行期改 profile | 常被编进 modelId，没有统一独立字段 |

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

- **内置 DSH 只启动它公开的 `dsh --profile acp`。** profile 与插件仍由 DSH 自己管理，
  omni 不代装、不代升级；兼容性探测会真的发送一次 ACP `initialize`，因此缺 profile、插件依赖错配与
  协议版本不合都会按原始启动结果报告，而不是看见配置文件就猜成可握手。该入口没有公开凭证就绪状态，
  所以握手成功不等于 provider/model/API 已可用；桌面层只在用户确认 DSH 原生配置完成后才探测并列出它。
- **DSH 0.1.0-rc.6 的 automation-only ACP 基线只认领新建文本会话、取消与权限决策。**
  本机握手没有上报模型清单、续跑、分叉、压缩、插话或档位回读；通用驱动因此不显示这些控件，
  后续能力只随 DSH 自己的 ACP 回包增加，omni 不补一套私有控制面。
- **Claude 侧只覆盖 `SDKMessage` 联合的一小部分。** 该联合有 38 个成员，
  驱动只翻译 assistant / stream_event / result / system 四类，**其余丢弃**（曾经写着「或落 `meta`」，而那个字段从来没被写过，已删）。
  新增覆盖时先确认它是否真的需要进 transcript。
- **Claude Auto 受账号、模型、提供方与管理员策略约束。** SDK 类型公开了该档，
  但运行环境不满足时 Claude 会明确拒绝；驱动保留这个原生失败，不静默退回 `default` 冒充自动审批。
- **Claude 轻量版要求 PATH 上的 `claude` 可运行。** 完整版仍由 SDK 解析内置平台二进制；
  两者都走同一个 SDK 驱动、原生鉴权与设置，不是两套行为实现。
- **内置 Kimi 要求带 `web` 子命令与公开 API 的 Kimi Code。** 当前验收版本是 0.37.2；
  启动后还会读 `/meta` 确认 WebSocket 与 bearer 鉴权，缺能力就明确失败，不回退 ACP。
- **Kimi Web API 只列 skills，不列它自己 Web/TUI 的完整控制命令。** 0.38.0 的公开 OpenAPI 仍只有
  `GET /skills` 与 `POST /skills/{name}:activate`，没有 commands list/run；`/goal`、`/plan`、`/login`
  等是 Kimi Web 客户端自己合并的本地菜单。驱动不复制这份私有静态表，只展示并原生激活服务端上报的
  skills；计划档、压缩、侧问等已有公开能力由各自的 omni 界面入口承载。
- **Kimi 的 steer 在同一原生 turn 的下一模型 step 前生效。** 它不会掐断已经发出的单次
  模型请求，也不会杀掉正在执行的工具；工具或当前生成结束后，插话才进入下一 step。
- **Kimi 的结构化多选问题还没有对应的 omni UI 契约。** 驱动会明确报出问题摘要并调用
  Kimi 原生 dismiss，绝不替用户猜一个选项。普通工具审批不受影响。
- **Kimi 只能从会话末尾原生分叉。** 宿主要从更早轮次分叉时，驱动明确拒绝，交给
  现有的跨引擎/降级路径；不会把“复制整条会话”冒充成“从指定轮次分叉”。
- **ACP 侧的能力由 agent 自报**（`capabilitiesOf`），不再一律 `NO_CAPABILITIES`。
  旧 Kimi ACP（`kimi acp`，0.36.1）的实测仍作为通用驱动样本保留：能贴图、能原生分叉、能列历史、能续跑，
  **不能压缩**（`session/compact` → Method not found）、不能改向（ACP 没这个入口）。
  这不再描述内置 Kimi；`sessionCapabilities` 用空对象当标记，所以判据仍是「键在不在」。
- **但「没声明」不等于「不支持」。** 实测 grok（`grok agent stdio`，0.2.106）的
  `sessionCapabilities` 是个**空对象**，一条能力都不报，而 `session/list` 答得好好的。
  只认声明的话它的历史区永远是空的——**那是「替引擎回答」的另一种写法**，
  只不过这次替它答的是「不支持」。所以 `canList` 是三态：声明了就用，
  没声明的问一次，问不出来才记成不支持。
- **grok 的推理强度报得出来、设不了，所以 omni 不上报它。** 四档强度挂在
  `models.availableModels[]._meta.reasoningEfforts`，但 `session/set_mode` 在这个版本上
  是个空壳：连**不存在的档位**它也回 `{}`，磁盘上 `reasoning_effort` 纹丝不动。
  对照组是 `session/set_model`——假 id 回 `-32602 unknown model id`，真 id 落盘。
  报了强度就是给用户一个点了没用的控件。
- **ACP 的审批请求里没有命令原文，所以命令红线对 ACP 的 shell 命令是失明的。**
  旧 Kimi ACP 的真机时序：`tool_call`（带 kind、无命令）→ `session/request_permission`
  （无 kind、无命令）→ **批准之后**才来 `tool_call_update {rawInput:{command}}`。
  于是判定器拿到的 `args.command` 是标题那个占位串（`"Bash"`），
  `rm -rf`、凭据读取这类**基于命令文本**的红线一条都匹配不上。
  协议里没有「批准前告诉我要跑什么」，这一层修不了——档位与路径红线仍然生效，
  内置 Kimi Web 在审批前会给完整 command display，因此不受这个 ACP 限制。
- **各家往 ACP 的 `kind` 枚举上映射是有损的，所以判定器还看一眼工具名字。**
  旧 Kimi ACP 实测只映射十个名字（`Read`/`Glob`/`Grep`/`Write`/`Edit`/`Bash`/`Terminal`/
  `WebFetch`/`WebSearch`/`Think`），**其余一律 `other`**——它 k3 那套工具叫
  `Shell`、`ReadFile`，全部落成 `acp:other` → `unknown` → 自动编辑档下每条都弹窗。
  驱动因此把 `title` 原文放进 `Request.toolLabel`，判定器在 `tool` 认不出来时
  按名字词根补一次方向（`@omni/approval` 的 `NAME_CATEGORY`）。
  **没有兜底成 allow 的分支**：认不出方向照旧 `unknown`。
- **grok 不发 ACP 的 `usage_update`**（kimi 一轮一条，grok 零条）。它的 token 数在
  `_x.ai/session_notification` 的 `turn_completed` 里，窗口大小在
  `models[]._meta.totalContextTokens`。私有通知的解析按引擎注入
  （`AcpDriverConfig.contextUsed`），驱动这一层不认识任何一家的私有方法名。
- **Grok 1.0.5 的 ACP 已公开原生 Auto。** `session/new` 的 `_meta.autoMode:true`
  会接上它自己的分类器；`_meta.yoloMode:true` 是更宽的 Always-approve，而且优先于 Auto。
  三档现在分别显式传 `{false,false}` / `{false,true}` / `{true,false}`，不再把自动审批
  与完全访问都压成 yolo。真机 debug 已看到分类器接线与 `auto permission mode set to: true`。
- **Grok 的审批档仍只在会话开场设置。** `session/load` 会接收同样两枚扩展位，所以
  空闲时换档会保留原生 session id 续接重启；运行中不打断，也不先显示一个尚未生效的档位。
  Auto 还受 Grok 自己的 feature gate 与管理员策略约束；ACP 回包没有独立的审批档读回字段，
  omni 不从普通 `current_mode_update` 猜它是否启用。
- **codex 侧只消费 74 种通知里的一小撮**：item 生命周期、文本与命令输出的 delta、
  用量、`turn/completed`、`error`。其余（MCP 进度、审批复核、实时语音…）一律丢弃。
- **codex 的 OS 沙箱与审批评审器在 `thread/start` 时定死，`setTrust` 改不了它们。**
  **实测证实改不了**：拿 `approvalPolicy: "never"`（完全不问客户端，写没写成纯由沙箱决定）验过，
  read-only 会话写文件被拦；同连接 `thread/resume` 换成 `workspace-write` 之后**照样被拦**；
  而全新的 workspace-write 会话写得成。所以判据有区分力，结论是沙箱确实定死。
  `thread/settings/update` 也不行——它什么都收、回 `{}`、不发任何确认，效果验不了。
  宿主现在只在空闲时释放旧进程，用同一个 native handle resume 并传入新三元组；运行中拒绝换档，
  不会为了权限切换打断当前轮，也不会先写一个并未生效的新档位。
- **各家自己的放行表都在 omni 之前生效**：Claude 是用户写的 allow 规则，
  codex 是内置可信命令表（`ls`、`sed`、`cat` 这类根本不会送到客户端）。
  这是「引擎原生」这个前提的必然代价——用户的原生配置压过宿主的自动策略。
- 事件流不做背压。宿主必须能消费得比引擎产出快，否则内存增长
  （渲染层那一侧已经在主进程做了合帧，见 `apps/desktop/src/main/batch.ts`）。
- **Claude 的推理强度改不了运行期**：`effort` 是 `query()` 的 `Options` 字段，
  SDK 没有 setter。所以 Claude 驱动不上报 `efforts`，界面上也就不显示那个控件。
- **ACP 侧只消费一小撮 `session/update` 类型**：文本 / 思考 / 工具 / 计划 / 用量 / 换档 /
  可用命令。其余（`session_info_update`、`config_option_update`…）一律丢弃。
- **ACP 的斜杠命令只能等它推**：协议没有「列命令」的请求方法，所以不像 codex 那样
  开场问一次，而是收到 `available_commands_update` 就发一条 `commands.updated`。
  什么时候推、推几次由 agent 定（实测 grok 在 `session/new` 之后推 12 条内建命令，
  kimi 把它认到的 skill 也报在同一条里）。
- **omni 不认领 ACP 的 `fs/*` 与 `terminal/*`**。`fs` 的用处是让 agent 看见编辑器里
  没存盘的缓冲区——omni 没有编辑器；`terminal` 认领了就等于命令跑在 omni 进程里，
  和「引擎跑自己的原生进程与沙箱」这个前提直接冲突。实测不认领也拿得到命令输出
  （从 `rawOutput.formatted_output`）。
- **ACP 的 mode 是 agent 自定义字符串，omni 的信任档只能打分匹配**（`acp/mode.ts`）。
  匹配不上就保持 agent 默认档并报一条 `engine.status`——硬塞一个猜的 mode，
  塞错方向就是悄悄放开了权限。
- **ACP 的一条消息是我们「划」出来的**。协议只给裸 chunk，连 `messageId` 都没有。
  连续同类算一条，被工具调用或换类打断就收口。这段划分在 `acp/update.ts`。
