# @switchback/engine

把各家原生 agent 翻译成 `@switchback/protocol` 的事件模型。每个驱动一个子目录，
对上暴露同一个 `EngineDriver` 契约，对下讲各家自己的协议。

引擎跑自己的原生进程、用自己的鉴权和模型配置。Switchback 不重写任何一家的循环。

## 拥有什么

- `EngineDriver` / `EngineSession` 契约（`contract.ts`）
- `subprocess.ts` —— 进程组所有权与回收阶梯，各引擎共用；`pid()` 报组长 pid（退了就不报），
  各驱动经 `EngineSession.pid` 交给宿主，桌面端的外发守卫靠它把流量记到这一家、这条会话上
- `rpc.ts` —— JSON-RPC 2.0 over 换行分隔 JSON。**codex 与 ACP 共用一份**（对端报的错以 `RpcError` 抛出，错误码留着——ACP 的 `-32000` 只能靠它认）：
  接 ACP 时这个文件从 `codex/` 提到包根，一个字没改就跑通了
- `claude/` —— Claude Agent SDK 驱动（`@anthropic-ai/claude-agent-sdk`）
  - `permission.ts` 把 SDK 的 `canUseTool` 请求翻成 `@switchback/approval` 的 `Request`，
    再把 `Verdict` 翻回 SDK 的 `PermissionResult`
  - `denials.ts` 配对自动拒绝提示、工具结果与 result 的权威拒绝清单；工具明确落 `denied`，
    保留 Claude 原始原因，拒答回退撤销工具时同步清掉结算缓存
  - `trust.ts` 把三档落到 Claude 原生 Plan / Auto / Bypass；进入 Bypass 时显式带 SDK 安全开关
  - `executable.ts` 区分完整版的 SDK 内置 CLI 与轻量版的系统 `claude`，并保持各自探测语义
  - `translate.ts` 把 `SDKMessage` 翻成 `Event`；`loop-wire.ts` 区分主线与 sidechain，
    `sidechain.ts` 用 task 生命周期给 `parent_tool_use_id` 找到原生 lane，再复用正文、流式与工具翻译；
    找不到权威父级就保持不可见，不把子代理明细冒充主线失败
  - `result.ts` 把 Claude 原生 steer 前后的多段 result 折回同一个宿主轮次，
    并以控制请求的当前上下文快照结算用量，不把整轮累计流量冒充窗口占用
  - `context-probe.ts` 去重在途上下文控制请求，并以模型 epoch 挡住切换前的迟到快照；
    `account.ts` 读取 SDK 官方账号字段，`mcp-status.ts` 去重报告启动失败与待授权状态
  - `conversation.ts` 接住 `/clear` 的原生 reset：保留旧记录作历史、留下上下文分界，
    并由随后 result 的新 session id 开启下一段可续跑记录
  - `messages.ts` / `retraction.ts` 维护 SDK wire uuid 到 transcript item 的映射；拒答切换模型重试时
    按 `supersedes` 与结算清单幂等撤回旧正文、工具与计划，并同步原生会话模型
  - `refusal-dialog.ts` 只声明 SDK 的 `refusal_fallback_prompt`，把切备用模型与修改后重发
    投影成宿主结构化问题；选择或关闭后才撤回旧片段，轮次中止则保留现场
  - `compaction.ts` 把 `/compact` 的 status 与 compact boundary 合成一条原地更新的提示，
    成功保留压缩前后 token，失败保留 SDK 原始原因
  - `hooks.ts` 在 SDK 的公开可见性开关下配对原生 Hook 起止；快速无输出成功保持安静，
    慢任务、原始输出与失败进入所属轮次，启动阶段的异常进入会话状态
  - `informational.ts` / `notification.ts` / `plugin-install.ts` / `local-command.ts` / `limits.ts` / `thinking.ts` / `memory.ts`
    翻译 SDK 明确交给宿主展示的转录提示、原生瞬时通知、用户已开启的插件同步进度、本地斜杠命令文本、订阅限额、当前思考块的近似 token 进度与记忆召回来源；
    思考进度只活在当前轮，记忆正文不在 transcript 重复落一份
  - `elicitation.ts` / `elicitation-url.ts` / `elicitation-complete.ts` 把 MCP 的原生扁平表单和外部交互地址翻成结构化问题卡；
    表单值按原始类型回送，URL 只在作答设备经用户显式同意后交给浏览器，服务端完成确认回会话横幅
  - `caps.ts` 能力表态与它的凭据（摊在驱动里读不动，且证据比代码长）
  - `tasks.ts` 把 started / progress / updated / notification 四条公开消息按 task id 合成
    完整生命周期，并保留启动工具与 task id 的原生对应：活动行只活在当前轮，lane 保留
    稳定标题、最近进度树、原生终态、总结以及 `forwardSubagentText` 给出的逐句过程
  - `workflow.ts` `task_progress.workflow_progress` → 一条 `Lane`。
    **一个 workflow 一条 lane，不是一个 agent 一条**——整批共用一个 `task_id`，
    每-agent 的明细进 `LaneProgress.nodes`；30 个 agent 每 tick 产生 30 条落盘事件
    是不能接受的
  - `history-files.ts` 有界并发枚举主会话与文件头，过滤子 agent / 空文件；`image.ts`
    是 Claude、Kimi 与 ACP 共用的内联图片格式、体积和 fail-closed 读取边界
  - `driver.ts` 会话生命周期与进程回收
- `codex/` —— `codex app-server --stdio` 驱动（JSON-RPC 2.0）
  - `rpc.ts` 分帧与请求关联。纯粹字节进字节出，不碰子进程，
    所以没装 codex 的机器上也能跑测试
  - `wire.ts` 线上类型的窄声明（权威定义用 `codex app-server generate-ts` 自己生成）
  - `translate.ts` / `notify.ts` 通知 → 事件；文件 patch 与 MCP progress 原地更新，
    没有 status 的工具以 completed 生命周期收口，模型安全改道同步当前设置
  - `approve.ts` 精确路由 app-server 反向 RPC；`permissions.ts` 把额外网络/文件 profile
    请求单独翻译成 `@switchback/approval`，并按要求回 `{permissions, scope}`
  - `user-input.ts` 把原生选项、备注、自由回答与密文标记翻成宿主问题卡，再按 Codex
    的 label / `user_note:` 数组回送；非阻塞问题采用原生 `autoResolutionMs`，缺席才回落 120 秒
  - `server-requests.ts` 持有每条反向 RPC 的取消柄；对端 `serverRequest/resolved`、进程退出
    或会话释放时撤销宿主等待，压掉迟到回包
  - `skill-catalog.ts` 以当前工作区读取原生 skill；`skills/changed` 到达后强制重扫并整表替换
    斜杠目录，连续通知只采用最后一份回包
  - `warnings.ts` 保留运行、安全守护、配置与弃用警告原文；轮次内落提示 item，开场落会话横幅
  - `safety.ts` 显示安全缓冲、严格复核、网络安全资质验证与模型安全改道；保留原生型号和原因
  - `hooks.ts` 配对原生 Hook 起止：快速无输出成功保持安静，慢任务与原始结果留在所属轮次
  - `terminal.ts` 把后台终端轮询与 stdin 写入并回原命令；等待态实时显示，输入在终态后仍留痕
  - `goal.ts` 校验并翻译原生长期目标完整快照；清空与恢复快照通过会话回调交给宿主落盘
  - `compaction.ts` 让手动压缩占住宿主轮次；稳定的 contextCompaction item 落原生提示
  - `fork.ts` 用 `thread/read(includeTurns)` 读取原生 turn id，把边界前最后一轮交给
    `thread/fork.lastTurnId`；公开协议无法表达首轮之前，宿主将其建成诚实的空白分支
  - `model-catalog.ts` 追完 `model/list` 游标，去重隐藏项并按目标模型校验推理强度；
    input modalities 随模型目录交给桌面约束附件入口
  - `account.ts` 用公开 `account/read` 探测登录态；MCP 状态区分 ready / failed / cancelled
    与 reauthenticationRequired，不把单个服务失败冒充整台引擎失败
  - `history.ts` 消费 `thread/resume` 已返回的完整 turns：恢复用户图片、回答、推理、工具和
    原生失败，过滤空推理与内部活动帧；超长会话留最近 1500 条并把真实总数交给宿主提示
  - 任意信任档切换时返回“需重启”，由宿主续接同一 native thread 重建原生沙箱与评审器
- `kimi/` —— `kimi web` 驱动（本机 bearer REST + WebSocket）
  - `server.ts` 只接 loopback 地址，一份私有服务由活跃 Kimi 会话共享，最后一条释放时回收
  - `http.ts` / `stream.ts` 负责原生 envelope、游标补发与断线重订；`text-stream.ts`
    按公开 offset 去重和裁重叠后缀，发现缺口就从原子快照水位重建。断开时照实报是怎么断的
    （`KimiDisconnect`：对面关的带关闭码与原因 / 要重新同步 / Switchback 自己处理某一帧出错），
    `disconnect.ts` 写成 `reconnecting` 的那句 detail；重连 0 → 8 秒退避、共六次，接不回来才报 `crashed`
  - `session.ts` 接会话、审批、模型、档位、历史、侧问与归档；`prompt.ts` 接普通提示与插话
  - `interactions.ts` 接公开的审批与结构化问题：问题文本和选项只做安全清洗，
    单选、多选、其他答案与跳过按 Kimi 原生形状回送；另一客户端落定或快照移除时同步撤销宿主等待
  - `skill.ts` 只投影 Kimi 上报的可激活 skill，并通过公开 `:activate` 入口执行
  - `activation.ts` 保留原生 skill / plugin command 激活标记并按 activation id 去重；
    `transcript.ts` 隐藏只供模型使用的展开内容，跨页恢复同一标记
  - `activity.ts` 把公开的子代理帧与后台任务帧折成 activity lane：后台任务收下引擎自报的
    **命令原文**（`task.started` / `task.terminated` 的 `info.command`），命令与结论都不由 Switchback 拼
  - `shell-history.ts` 按公开 transcript 的 `shell_command` 来源恢复 Kimi 原生 `!` 命令与输出，
    去掉内部 XML 和终端控制字符，不把进程输出冒充用户消息
  - `native-turn.ts` 接住同会话其他 Kimi 原生客户端公开发起的普通用户轮；只有宿主空闲且
    `origin:user`、可见 prompt 与原生 turn id 都齐全才认领，shell 历史不混入
  - `goal-continuation.ts` 识别公开的 `system_trigger/goal_continuation`；同一次长期目标运行的
    多个原生 turn 沿用一个宿主轮，只有断线接入时才建立新身份，正文区保留空边界而不显示内部提示
  - `turn-finalize.ts` 统一原生分段与宿主轮的收口：目标仍 active 时只结清当段正文和工具，
    最终目标状态或非续跑终态到达后才交还宿主，排队消息不会抢进续轮间隙
  - `wire.ts` / `transcript-wire.ts` 是 Kimi 服务自己公开的 OpenAPI、AsyncAPI 与历史投影窄声明
  - `compaction.ts` / `turn-events.ts` 接手动与自动压缩的开始、阻塞、完成和取消，不提前收掉模型轮；
    `cron.ts` 配对原生主动轮的开始与任务原文，再交宿主建立主线身份
  - `step-outcome.ts` 接 Kimi 实时报出的 `max_tokens`、provider filtered 与 interrupted step 结论；
    半截工具参数落成未执行的失败卡，冷历史另从公开 interruption marker 恢复用户取消，不从正文猜原因
  - `turn-recovery.ts` / `turn-transcript.ts` 在首次接管与断线重同步时，用公开 transcript
    的同一原生 turn id 补回定时、其他客户端用户或目标续轮来源，并按 step 恢复离线正文、思考、工具与终态；
    快照只续接当前 step 的 volatile 尾巴
  - `goal.ts` 校验 WebSocket 与 REST 的原生长期目标完整快照；明确 null 清空，断线后重新读回
  - `activity.ts` 显示原生子代理与后台进程；兼容任务双帧按 id 去重，快照与 `/tasks` 补回终态
  - `warnings.ts` 把轮次外警告送到会话横幅；启动与重连从 `/warnings` 补回可能错过的原生帧
  - `diagnostics.ts` 去掉失败轮的相邻 error 副本，把压缩等轮次外原生错误送到高优先级横幅
  - `mcp-status.ts` 以目标会话校验过的 REST 快照补开场，并把实时失败与待登录状态报告为能力降级
  - `hook-result.ts` 按 Kimi 自己的 assistant 样式保留 UserPromptSubmit Hook 输出与阻断说明
  - `log.ts` 只负责定位 Kimi 保存的全量 `wire.jsonl`，供跨引擎接力引用
- `acp/` —— 通用 ACP over stdio 驱动（Agent Client Protocol）
  - **一个驱动接所有只从 ACP 出线的引擎**；Grok、DSH 与用户自配引擎共用
  - `wire.ts` 线上类型的窄声明（权威定义：`npm pack @agentclientprotocol/sdk`）
  - `update.ts` `session/update` → 事件，含**文本块划分**（见下）
  - `translate.ts` 工具形态与停止原因
  - `setup.ts` 从 `session/new` 里挖模型与档位（两代适配器字段名不同）
  - `mode.ts` 信任档 → agent 自己定义的 mode，**打分匹配**
  - `permission.ts` / `approve.ts` 审批判定与选项挑选
  - `interaction.ts` 管理私有阻塞式反向请求的宿主等待；同一原生身份被其他客户端先落定时撤销本地卡片
  - `prompt.ts` / `native-turn.ts` 统一普通与原生主动 prompt；主动轮忙时排队、在途去重、收工后续跑
  - `grok-scheduled.ts` 只认 Grok 到点通知给出的任务原文、计划与 id，并用其原生 prompt 标识发回
  - `grok-interaction.ts` 把 Grok `AskUserQuestion` 与 `exit_plan_mode` 的题目、选项、聚焦预览、计划正文和反馈翻成宿主问题卡，按原生响应形状回送
  - `grok-activity.ts` 镜像 Grok 私有通知里的后台任务、Monitor 输出、子代理、workflow 与长期目标；输出仍回到原生工具 item，不复制任务查看器协议
  - `auth.ts` 认 `initialize` 报的登录方式（`type: "terminal"` 与旧的 `_meta["terminal-auth"]`
    两代写法，`_meta["api-key"]` 标出要 key 的那种），并在握手里声明客户端能跑 terminal 型登录；
    开会话撞上 `-32000` 时抛 `AcpAuthRequired`：它自己的原话在前，它报的登录方式与去处在后，
    宿主据此报 `unauthenticated` 而不是 `crashed`
  - `login.ts` 只做转达：一次性进程里握手后发 `authenticate` / `logout`（agent 型，最多等五分钟、可取消），
    terminal 型只算出要在终端里跑的整条命令（启动命令 + 追加参数，旧写法用它给的整条命令）；
    `oneshot.ts` 是试接、登录、退出共用的「起进程 → 握手 → 办完就回收」
  - `grok.ts` 负责它的会话记录路径；`kimi.ts` 仅是废弃 ACP 链路的兼容重导出。
    内置 Kimi 不再注册 `kimi acp`，Kimi 的日志定位归 `kimi/log.ts`

## 不拥有什么

- **不拥有审批判定**。判定在 `@switchback/approval`，本包只做协议翻译与应答。
- 不拥有 UI。需要人工裁决时调 `StartRequest.askUser`，由宿主决定怎么呈现。
- 不拥有持久化。事件流往外发，落盘是 `@switchback/journal` 的事。
- 不拥有凭证。ACP 的登录只是把人挑的那种方式转给 agent（`authenticate`），或给出它自己的终端登录命令；
  开浏览器、收回调、存凭证都是 agent 的事，本包看不到任何一个凭证。
- 不拥有引擎的安装与模型选择——用宿主上已有的原生配置。

## 四条链路的结构差别

接到第四条协议链才看清的东西，写下来免得下次又当成一样的：

| | Claude Agent SDK | codex app-server | Kimi Web | ACP |
| --- | --- | --- | --- | --- |
| 审批载荷 | `canUseTool` 带**完整**工具名与参数 | 只带 `itemId`，命令和 diff 在此前的 item 里 | 请求前就带工具名、action 与完整 display | 只带 `toolCallId` + kind + status，同样要查在途表 |
| 怎么回审批 | allow / deny | `accept` / `decline` / `acceptForSession` | `approved` / `rejected`，可记到 session | **agent 自己给的一张选项表**，按不透明 `optionId` 回 |
| 档位落点 | `permissionMode`：`plan` / `auto` / `bypassPermissions`；未被原生模式结算的请求才走 `canUseTool` | `sandbox` + `approvalPolicy` + `approvalsReviewer`；`auto_review` 才是 “Approve for me” | `permission_mode` + `plan_mode`，可写也可读回 | 通用路径是 `session/set_mode`；Grok 1.0.5 的审批另走 `_meta.autoMode` / `yoloMode` |
| 文本身份 | 整块消息 | item 生命周期 + delta | 原生 turn / step / frame + delta | **一串裸 chunk，没有 id、没有开始、没有结束** |
| 工具身份 | 工具名 | item `type` + `commandActions` | `toolCallId` + 名字 + args + display | 只有短枚举 `kind`，**没有工具名字段** |
| 推理强度 | 每模型 `supportedEffortLevels`，运行期走 `applyFlagSettings` | 独立 `reasoningEffort` | 每模型 `support_efforts`，运行期改 profile | 常被编进 modelId，没有统一独立字段 |

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

## 已知限制

- **只有 claude 与 grok 报得出「这一次请求生成了多少 token」（`Usage.outputTokens`）。**
  claude 取 `result.usage.output_tokens`，grok 取 `_x.ai/session_notification` 的
  `turn_completed.usage.outputTokens`——两个都是这一轮的量。**kimi、codex、通用 ACP 报不出**：
  kimi 给的两处（事件的 `usage.total.output`、状态快照的 `output_tokens`）都是**会话累计**，
  codex 只有 input+output 合一的 `last.totalTokens`，通用 ACP 只有 `used`。
  那三家这个字段一律缺席，**不拿累计值或减法凑一个**——消费方据此退回按字节估并打上波浪号，
  而一个填错的「最近一次生成量」会让界面算出荒谬的 t/s，比缺席糟得多。
- **内置 DSH 只启动它公开的 `dsh --profile <profile>`。** 新会话采用设置中选中的 profile，
  旧会话按自己保存的 profile 续接；profile 与插件仍由 DSH 自己管理，
  Switchback 不代装、不代升级；兼容性探测会真的发送一次 ACP `initialize`，因此缺 profile、插件依赖错配与
  协议版本不合都会按原始启动结果报告，而不是看见配置文件就猜成可握手。该入口没有公开凭证就绪状态，
  所以握手成功不等于 provider/model/API 已可用；桌面层只在用户确认 DSH 原生配置完成后才探测并列出它。
- **DSH 0.1.0-rc.6 的 automation-only ACP 基线只认领新建文本会话、取消与权限决策。**
  本机握手没有上报模型清单、续跑、分叉、压缩、插话或档位回读；通用驱动因此不显示这些控件，
  后续能力只随 DSH 自己的 ACP 回包增加，Switchback 不补一套私有控制面。
- **同一条 DSH ACP 也不发布工具过程。** 真机让它改临时文件时，文件与最终正文都成功，
  但线上只有 `agent_message_chunk`，没有 `tool_call*`；DSH 源码契约也明确把推理与工具活动留在
  自己的 session log。Switchback 不读私有日志反编事件，工作树净变化仍由 desktop 的 Git 基线核对。
- **Claude 侧只覆盖 `SDKMessage` 联合中有当前产品语义的部分。** 该联合有 39 个成员；
  assistant、流式增量、工具结果、轮次结果、用量、订阅限额、权限档、任务生命周期，以及 SDK 明确要求宿主展示的
  `system/informational`、本地斜杠命令输出、权限拒绝、Hook 生命周期、思考 token 进度、记忆召回、
  拒答回退与无回退说明、API 可恢复重试、原生通知队列、MCP 外部交互完成确认、显式开启的插件同步进度、
  中途命令整表替换、上下文压缩生命周期已接入，其余仍丢弃。
  流式增量由 `includePartialMessages` 显式开启并按原消息身份归并，供转录区打字机、桌宠和速率统计共用。
  新增覆盖时先拿源码契约或活体帧确认它真的需要进 transcript 或会话状态。
- **Claude `/goal` 当前没有可消费的目标状态帧。** SDK 0.3.231 导出了 `SDKActiveGoalMessage`，
  运行时也有转发分支，但内置 CLI 2.1.231 真跑已设置、未完成与完成三条路径都没有向 SDK 流发
  `active_goal`；原生日志里的 `goal_status` 能证明评估器确实运行，却不是公开事件出口。
  Switchback 不从命令文本或私有日志反推目标，等 Claude 真正在 SDK 流上报后再接。
- **Claude Auto 受账号、模型、提供方与管理员策略约束。** SDK 类型公开了该档，
  但运行环境不满足时 Claude 会明确拒绝；驱动保留这个原生失败，不静默退回 `default` 冒充自动审批。
- **Claude 拒答对话的“修改后重发”不会自动回填输入框。** 当前公开 dialog payload 只带原模型、
  备用模型、引导文案与撤回 uuid，不带原提示正文，也没有 composer prefill 回调；Switchback 因此如实结束当前轮，
  让用户在输入框自行修改后发送，不从 transcript 猜一份文字塞回去。
- **Claude 的终端专用命令标记只随首轮 `system/init` 出来。** 开场 `supportedCommands()`
  没有该字段，所以全新会话第一条消息前，GUI 的目录可能短暂包含当前版本的
  `/doctor` / `/color`；首轮开始即按原生标记剔除，动态清单同样过滤。驱动不硬编码名字，
  也不为获得这个标记偷发一条模型消息。
- **Claude 轻量版要求 PATH 上的 `claude` 可运行。** 完整版仍由 SDK 解析内置平台二进制；
  两者都走同一个 SDK 驱动、原生鉴权与设置，不是两套行为实现。
- **内置 Kimi 要求带 `web` 子命令与公开 API 的 Kimi Code。** 当前验收版本是 0.38.0；
  启动后还会读 `/meta` 确认 WebSocket 与 bearer 鉴权，缺能力就明确失败，不回退 ACP。
- **Kimi 0.38.0 的冷 transcript 会丢掉 step finish reason 和多数 interruption reason。**
  用户主动停止另有公开 `interruption` marker，Switchback 会据此恢复；`max_tokens` 与安全过滤的 raw reason
  没有对应的持久字段，只能在实时接入时显示。Switchback 不从半截正文、token 数或最终状态反猜原因。
- **Kimi 0.38.0 没有公开的终端命令执行路由。** 原生 `!` 由发起它的 TUI 本地执行，公开
  transcript 只保存输入与输出，实时 `shell.*` 帧也依赖该 TUI 自己持有的输出流。Switchback 因此只恢复
  已保存的终端历史，不新增执行按钮、不直接跑本机 shell，也不为别处发起的命令伪造实时状态。
- **Kimi 后台任务的输出不在实时流上。** 0.38.0 真机（2026-08-25）核对：`task.started` /
  `task.terminated` 只带 `command`、`exitCode`、`startedAt` / `endedAt`，没有任何输出字段；
  输出在它 REST 那侧（`GET /sessions/{id}/tasks` 的 `output_preview`、
  `/tasks/{id}?with_output=true`），而 Switchback 目前只在启动与重连读回任务表。所以 lane 上一定有命令原文，
  **结论只有引擎把它报进任务读回时才有**。Switchback 不去读它 `~/.kimi-code/…/tasks/*/output.log`——
  那是拿它的零件替它攒功能。要按需取输出，得先有一条「打开这条旁路」的控制面，那是另一件事。
- **Kimi 实时连接频繁断开的根因还没钉死。** 2026-09 在一台机器的日志里见到两千多次断开，
  成对出现、活跃时段里约每 32–37 秒一次——正好是 Kimi 服务端心跳规则（每 10 秒 ping，20 秒收不到
  任何入站帧就以 1001 `heartbeat timeout` 关掉）加上重连耗时。本机按 Switchback 的写法回 pong、挂真驱动空会话，
  都复现不出来。以前四种断法报的是同一句话，分不清；现在每次断开的原因都进 `reconnecting` 的 detail
  （也就进了主进程日志），主进程另记卡顿（见 desktop 的 `stall.ts`）。**驱动不为此加私有保活帧**：
  那是拿对面「任何入站帧都算活着」这个实现细节替它的心跳协议打补丁。
- **Kimi 定时任务仍由 Kimi 自己创建、保存与调度。** Switchback 只在已接入会话的公开实时流收到
  `cron_job` 主动轮时显示当次执行，并从公开 transcript 恢复已经保存的结果；它不复制 Kimi 的
  cron 管理界面，也不自行补跑。首次接管或断线漏过开始帧但该轮仍在运行时，只按快照的原生 turn id
  读取公开 transcript 对应项后续接；离线错过的次数是否合并、过期任务是否最后执行，完全采用 Kimi 上报值。
- **Kimi 0.38.0 的 MCP REST 快照没有 session 参数。** 它固定读取“最近创建且仍活跃”的会话；
  驱动只有在快照前后都遍历公开会话清单、确认那个 id 正是当前目标时才采用，避免串会话。较旧会话续跑时若
  不是这个目标，开场 MCP 状态只能缺席；后续原生 `mcp.server.status` 翻面仍会实时报告并由游标补发。
  Switchback 不读私有事件日志，也不把另一条会话的工具状态猜到这里。
- **Kimi Web API 只列 skills，不列它自己 Web/TUI 的完整控制命令。** 0.38.0 的公开 OpenAPI 仍只有
  `GET /skills` 与 `POST /skills/{name}:activate`，没有 commands list/run；`/goal`、`/plan`、`/login`
  等是 Kimi Web 客户端自己合并的本地菜单。驱动不复制这份私有静态表，只展示并原生激活服务端上报的
  skills；计划档、压缩、侧问等已有公开能力由各自的 Switchback 界面入口承载。
- **Kimi 的 steer 在同一原生 turn 的下一模型 step 前生效。** 它不会掐断已经发出的单次
  模型请求，也不会杀掉正在执行的工具；工具或当前生成结束后，插话才进入下一 step。
- **Kimi 0.38.0 的自动审批档原生禁用 `AskUserQuestion`。** 它的权限策略会直接拒绝该工具，
  同时明确要求模型自行决定；Switchback 保留这项原生行为，不为了让问题卡出现而改档或注入开关。
  只读规划与完全访问档若由 Kimi 发出问题，则走公开 `event.question.requested` / `pending_questions`
  与 `/questions/{id}` 往返，桌面和远程端都能回答或跳过。
- **Kimi 只能从会话末尾原生分叉。** 普通完整分叉照常开放；「从这里重来」不会出现，
  驱动也会防御性拒绝带历史截断的请求，不把“复制整条会话”冒充成“从指定轮次分叉”。
- **ACP 的 terminal 型登录要人回来确认。** 协议里它没有带内的成功信号（终端里那个进程退出码 0 即成功，
  而那个进程由桌面交给系统终端跑，不在本包手里）；所以桌面只报「终端已打开」，登没登上要再试接一次才知道。
  agent 型则有回包，办完就是办完。
- **ACP 的 `env_var` 型登录（2026-07 已从协议里拿掉）与认不出的型一律跳过**，不替它猜要什么变量。
  要 API key 的那几种（`_meta["api-key"]`）照样列出、照样转达，key 由 agent 自己从环境里读。
- **ACP 侧的能力由 agent 自报**（`capabilitiesOf`），不再一律 `NO_CAPABILITIES`。
  旧 Kimi ACP（`kimi acp`，0.36.1）的实测仍作为通用驱动样本保留：能贴图、能原生分叉、能列历史、能续跑，
  **不能压缩**（`session/compact` → Method not found）、不能通过标准 `session/steer` 改向。
  这不再描述内置 Kimi；`sessionCapabilities` 用空对象当标记，所以判据仍是「键在不在」。
- **但「没声明」不等于「不支持」。** 实测 grok（`grok agent stdio`，0.2.106）的
  `sessionCapabilities` 是个**空对象**，一条能力都不报，而 `session/list` 答得好好的。
  只认声明的话它的历史区永远是空的——**那是「替引擎回答」的另一种写法**，
  只不过这次替它答的是「不支持」。所以 `canList` 是三态：声明了就用，
  没声明的问一次，问不出来才记成不支持。
- **Grok 1.0.5 的推理强度已读写闭环。** 四档来自
  `models.availableModels[]._meta.reasoningEfforts`，设置时按首方客户端形状并入
  `session/set_model._meta.reasoningEffort`；真机切到非默认档并收到模型回声。旧版把它错发到
  `session/set_mode`，那条空壳即使传不存在的档也回 `{}`，因此旧结论只描述那条错误接线。
- **Grok 1.0.5 的插话与完整分叉走首方扩展。** 运行中通过
  `_x.ai/interject {sessionId,text}` 真正改向；分叉用 `_x.ai/session/fork`，拿到
  `newSessionId` 后由新进程标准 `session/load` 接住。两条都已真机验证；历史截断仍不开放，
  因为当前公开 fork 没有 turn/message 边界，不能把完整复制冒充「从这里重来」。
- **标准 ACP fork 只承诺复制会话末尾。** `fork` 与 `rewind` 是两项能力：ZCode、旧 Kimi ACP
  以及其他只声明 `sessionCapabilities.fork` 的引擎可以完整分叉，但不会获得历史回退入口。
- **ZCode 的 steer 目前保持关闭。** zcode-acp-server 0.5.1 虽然公开并转发
  `session/steer`，本机 ZCode 后端 0.16.3 的活体调用仍回 `Method not found`。因此不能仅凭桥的
  路由或文档在 `engines.json` 放出按钮；等后端真正兑现并通过 live test 后再显式开启。
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
  按名字词根补一次方向（`@switchback/approval` 的 `NAME_CATEGORY`）。
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
  Switchback 不从普通 `current_mode_update` 猜它是否启用。
- **Grok 的循环任务仍由 Grok 创建、保存与调度。** 后台循环继续由它自己的子代理执行；前台循环到点时，
  1.0.5 会明确把 `scheduled_task_inject_prompt` 交给当前 ACP driver。Switchback 只把事件中的任务原文排进宿主主线，
  忙时等当前轮收工，并用 `scheduler-fired-` 原生标识让 Grok 把它记成 synthetic scheduled turn；不复制任务管理
  面板，也不补首方 pager 额外写入的 system-reminder。当前 stdio 实测会把方法改成 `_x.ai/...` 而保持直达参数，
  leader 模式则可能再套一层 method/params，两种生产形状都只在 Grok 注入模块识别。
- **codex 只消费当前产品确实有出口的通知**：item 生命周期及已展示的 delta、上下文压缩、计划、用量、
  会话设置、MCP 启动状态、反向请求撤销、skill 失效、Hook 生命周期、原生用户警告、安全检查状态、
  轮次终态与错误。
  其余（MCP 工具进度、临时 approval-review 内部详情、实时语音等）仍按协议兼容策略丢弃；新增覆盖前先确认
  它不是实验能力或另一条旧 API。
- **codex 的 OS 沙箱与审批评审器在 `thread/start` 时定死，`setTrust` 改不了它们。**
  **实测证实改不了**：拿 `approvalPolicy: "never"`（完全不问客户端，写没写成纯由沙箱决定）验过，
  read-only 会话写文件被拦；同连接 `thread/resume` 换成 `workspace-write` 之后**照样被拦**；
  而全新的 workspace-write 会话写得成。所以判据有区分力，结论是沙箱确实定死。
  `thread/settings/update` 也不行——它什么都收、回 `{}`、不发任何确认，效果验不了。
  宿主现在只在空闲时释放旧进程，用同一个 native handle resume 并传入新三元组；运行中拒绝换档，
  不会为了权限切换打断当前轮，也不会先写一个并未生效的新档位。
- **各家自己的放行表都在 Switchback 之前生效**：Claude 是用户写的 allow 规则，
  codex 是内置可信命令表（`ls`、`sed`、`cat` 这类根本不会送到客户端）。
  这是「引擎原生」这个前提的必然代价——用户的原生配置压过宿主的自动策略。
- 事件流不做背压。宿主必须能消费得比引擎产出快，否则内存增长
  （渲染层那一侧已经在主进程做了合帧，见 `apps/desktop/src/main/batch.ts`）。
- **Claude 的强度 setter 没有独立读回值。** 当前 SDK 通过每个模型的
  `supportedEffortLevels` 给出清单，`Query.applyFlagSettings` 在运行期设置；调用成功的判据是
  promise 正常完成。若它抛错，驱动会报 `degraded` 且不把请求值记成已生效档位。
- **ACP 侧只消费有当前产品语义的 `session/update` 类型**：文本 / 思考 / 工具 / 计划 / 用量 / 换档 /
  可用命令、`config_option_update` 的模型与强度目录，以及 `session_info_update` 的原生标题。
  其余未认领类型按协议兼容策略丢弃；新增覆盖前先确认 agent 确实把它当对外能力发布。
- **ACP 的斜杠命令只能等它推**：协议没有「列命令」的请求方法，所以不像 codex 那样
  开场问一次，而是收到 `available_commands_update` 就发一条 `commands.updated`。
  什么时候推、推几次由 agent 定（实测 grok 在 `session/new` 之后推 12 条内建命令，
  kimi 把它认到的 skill 也报在同一条里）。
- **Switchback 不认领 ACP 的 `fs/*`，`terminal/*` 则按引擎明确选择。** `fs` 的用处是让 agent
  看见编辑器里没存盘的缓冲区——Switchback 没有编辑器。Grok、ZCode 与 DSH 自己起命令进程，
  因此不认领 terminal，输出从各自的 `rawOutput` 回来；已废弃的 Kimi ACP 兼容样本反而要求
  客户端提供 terminal，不认领就一条 shell 都跑不了，所以只对那份显式开启。内置 Kimi Web
  不走 ACP。这一位不能全家族写死，否则一个方向会越过原生沙箱，另一个方向会让工具彻底失效。
- **ACP 的 mode 是 agent 自定义字符串，Switchback 的信任档只能打分匹配**（`acp/mode.ts`）。
  匹配不上就保持 agent 默认档并报一条 `engine.status`——硬塞一个猜的 mode，
  塞错方向就是悄悄放开了权限。
- **ACP 的一条消息是我们「划」出来的**。协议只给裸 chunk，连 `messageId` 都没有。
  连续同类算一条，被工具调用或换类打断就收口。这段划分在 `acp/update.ts`。
- **`activity` 只在拿到可验证原生活体帧的驱动上报 true。** 当前是 Claude、内置 Kimi、
  Codex 与内置 Grok；没有一家注入解析器的通用 ACP 仍是 false：
  - **Kimi Web**：0.38.0 公开 `subagent.*` 完整生命周期、会话快照的 `subagents`，以及
    后台进程的 `task.*` / `/tasks` 都已用隔离生产会话抓到并接入。两类都是镜像
    Kimi 自己已启动的活动，Switchback 不开 swarm，也不自建子代理。
  - **codex**：0.149.0 的公开 `thread/list` 已列出 100+ 条 `thread_spawn` 子 thread；
    抽查一条公开 `thread/read(includeTurns:true)` 的生产历史，73 轮里有 266 条
    `SubAgentActivity`。驱动按 `agentThreadId` / `agentPath` 投影原生树，并用公开
    `thread/status/changed` 的 active / idle / systemError 收口；Switchback 不调用 spawn、send 或 wait。
  - **内置 Grok**：协议里没有声明位，但 1.0.5 明确从私有通知发后台任务、Monitor、
    子代理、workflow 与 goal 生命周期；源码发送点、首方 Pager 消费点和真机后台任务/Monitor
    帧均已交叉确认，因此只在 Grok 注册配置上注入解析器。活动仍由 Grok 自己启动，Switchback 不编排。
  - **其余 ACP（zcode / DSH / 自配）**：没有对应解析器就保持 false。zcode 的前台子 agent
    走 `tool_call._meta.subagent`（那是**工具调用**，已经在主线上了），
    后台子 agent 的正文以裸 `agent_message_chunk` 混进主线、无标记，Switchback 单方面解不了。
    所以不从普通 `AcpSaid` 猜 activity——开了就等于替 agent 说一句它没说过的话。
- **Claude workflow 的阶段状态仍是算出来的，整条 lane 终态不是。** `workflow_phase`
  帧上没有 state，所以阶段先由子节点 `rollUp`；整条任务随后以公开的 `task_updated` /
  `task_notification` 落成原生 completed / failed / stopped。edge 丢失时，最后一棵完整节点树
  只作为防止活动行永远旋转的兜底，不覆盖后来到达的原生终态。
