# @omni/protocol

omni 的**归一化领域模型**。五家引擎的输出都翻译成这一套 `thread / turn / item`，
渲染层只认这一套，所以 UI 只写一遍。

三级原语借自 codex `app-server`（见 `agent-learn/codex/codex/codex-rs/app-server/README.md`
§Core Primitives），因为它是目前把「一次对话 / 一轮 / 一条产物」拆得最干净的现成模型。
厂商特有且没有界面语义的东西丢弃，不拿 `meta` 污染核心模型。曾经有过 `Item.meta` / `Turn.meta` / `Thread.meta` 三个出口，但从加上到删掉**没有一处写过、没有一处读过**——一个空的扩展位比没有更糟：读代码的人会以为「这里有机制」，而实际上数据到不了界面。真需要时再加，那时它会带着第一个使用者一起来。

## 拥有什么

- `Thread` / `Turn` / `Item` 三级原语与它们的状态机取值
- `TurnPace` —— 一轮的出字节奏（首字延迟、tok/s、生成量、是不是真数）。宿主收工时量出来挂在
  `turn.completed` 上落盘；流式增量不落盘，回放时没法再量一遍
- `EngineGoal` —— 引擎原生长期目标的只读镜像；跨轮次挂在 `Thread`，不与一次性计划混同
- `ToolDetail` —— 工具调用的五种渲染形态（shell / file_edit / file_read / fetch / other）；
  shell 可携带引擎明确上报的后台等待状态与 stdin 历史，输入和输出始终分开
- `NoticeItem` —— 引擎明确交给宿主展示的纯文本提示，保留原生级别，不冒充模型回答或错误
- `UserMessageOrigin` —— 区分人亲手发送与引擎公开能力产生的主线输入；结构化计划来源保留
  原生任务 id、表达式、合并次数与最后一次标记，原生终端命令不冒充聊天气泡；长期目标
  自动续轮只保留没有提示正文的原生边界，不把引擎内部 continuation prompt 冒充成用户输入，
  旧 `handoff` 字面量只负责读回历史日志
- `Event` —— 引擎 → 宿主 → 渲染层的单向事件流；item 可开始、追加、全量更新或由引擎明确撤回；
  原生一次性通知另走 `engine.notification`，保留 key、优先级和超时，不混进 transcript
- `Command` —— 渲染层 → 宿主的反向指令（提问、批准、中断、切档、接力）
- `QuestionPrompt` / `QuestionResponse` / `PendingQuestion` —— 引擎公开给宿主的结构化问题、
  用户原样作出的选择，以及挂在会话上的待回答组；单选、多选、其他答案、选项备注、自由回答、
  密文遮挡、选项聚焦预览、逐题/整组跳过与到期时间都有明确形状
- `Lane` / `LaneNode` / `LaneRef` —— **旁路**：属于这条会话、但引擎明说了它不属于
  主线 transcript 的东西（子 agent、编排进度、侧问）。`kind` 只有两档
  （`aside` 能问 / `activity` 只能看），因为界面上唯一真正的分歧是「这儿有没有输入框」；
  再细分是引擎自己的分类学，多分一档就多一处接第五家时要改的地方。
  `command` 是引擎自报的命令原文（后台任务），缺席就只画标题——**不从工具调用反推一条**
- `EngineCapabilities.activity` —— 这家引擎会不会把主线之外正在跑的东西报出来。
  **必填布尔**：新增一位时编译器会逐个点名所有驱动，让它们各自表态
- `EngineCapabilities.fork / rewind` —— 完整复制会话与精确停在历史边界是两项能力；
  分开建模，避免界面截短了转录而模型仍携带全部历史
- 全部是 `type` / `interface`，编译后无运行时产物

## 不拥有什么

- **不拥有任何逻辑**。没有函数、没有类、没有校验器、没有序列化实现。
- 不拥有各家引擎的原始事件格式——那是 `@omni/engine` 各驱动的私有细节
- 不拥有持久化格式——`@omni/journal` 自己决定怎么落盘
- 不拥有 ID 生成——ID 由宿主铸造并传入
- **不拥有「哪些 item 不许进旁路」这条约束的执行**。`ApprovalItem` / `ErrorItem` 和别的
  item 一样继承 `ItemBase`，类型上拦不住 `lane` 字段——闸门在
  `@omni/host` 的 `item-scope.ts`（`mainlineOnly`）。规矩是：**审批与错误永远留在主线**，
  否则侧栏关着、或用户在看另一条旁路时，一张正在等他点的审批卡会消失

## 已知限制

- `ItemId` / `ThreadId` / `TurnId` 是裸 `string` 而非 branded type。取舍：branded 能挡住
  「把 threadId 传进要 turnId 的位置」这类错误，但会在每个构造点引入转换仪式。
  当前选简单，**若真的被这类 bug 咬过就换 branded**。
- `Item` 联合目前 8 种。新增一种就要动所有渲染分支——这是有意的摩擦，
  逼迫优先考虑「能不能塞进 `ToolDetail.other`」。
- 事件流假设**有序且不丢**。传输层（宿主 → 渲染层 IPC）必须保证这一点，本包不做序号与重放——
  序号是传输层的事，落盘的事件里没有它。桌面端那侧的实现见
  `apps/desktop/src/main/sequence.ts`（编号与补发缓冲）与
  `apps/desktop/src/renderer/stream.ts`（游标与补洞）。
- `Event` 联合有一道**编译期穷尽检查**
  （`@omni/store` 的 `Handlers` 从 `Event["type"]` 映射出来），新增一种忘了接会编译不过。
