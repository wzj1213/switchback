# @omni/protocol

omni 的**归一化领域模型**。五家引擎的输出都翻译成这一套 `thread / turn / item`，
渲染层只认这一套，所以 UI 只写一遍。

三级原语借自 codex `app-server`（见 `agent-learn/codex/codex/codex-rs/app-server/README.md`
§Core Primitives），因为它是目前把「一次对话 / 一轮 / 一条产物」拆得最干净的现成模型。
厂商特有的东西**目前一律丢弃**，不污染核心模型。曾经有过 `Item.meta` / `Turn.meta` / `Thread.meta` 三个出口，但从加上到删掉**没有一处写过、没有一处读过**——一个空的扩展位比没有更糟：读代码的人会以为「这里有机制」，而实际上数据到不了界面。真需要时再加，那时它会带着第一个使用者一起来。

## 拥有什么

- `Thread` / `Turn` / `Item` 三级原语与它们的状态机取值
- `ToolDetail` —— 工具调用的五种渲染形态（shell / file_edit / file_read / fetch / other）
- `Event` —— 引擎 → 宿主 → 渲染层的单向事件流
- `Command` —— 渲染层 → 宿主的反向指令（提问、批准、中断、切档、接力）
- 全部是 `type` / `interface`，编译后无运行时产物

## 不拥有什么

- **不拥有任何逻辑**。没有函数、没有类、没有校验器、没有序列化实现。
- 不拥有各家引擎的原始事件格式——那是 `@omni/engine` 各驱动的私有细节
- 不拥有持久化格式——`@omni/journal` 自己决定怎么落盘
- 不拥有 ID 生成——ID 由宿主铸造并传入

## 已知限制

- `ItemId` / `ThreadId` / `TurnId` 是裸 `string` 而非 branded type。取舍：branded 能挡住
  「把 threadId 传进要 turnId 的位置」这类错误，但会在每个构造点引入转换仪式。
  当前选简单，**若真的被这类 bug 咬过就换 branded**。
- `Item` 联合目前 7 种。新增一种就要动所有渲染分支——这是有意的摩擦，
  逼迫优先考虑「能不能塞进 `ToolDetail.other`」。
- 事件流假设**有序且不丢**。传输层（宿主 → 渲染层 IPC）必须保证这一点，本包不做序号与重放——
  序号是传输层的事，落盘的事件里没有它。桌面端那侧的实现见
  `apps/desktop/src/main/sequence.ts`（编号与补发缓冲）与
  `apps/desktop/src/renderer/stream.ts`（游标与补洞）。
- `Item` 联合现在 7 种、`Event` 12 种。`Event` 那边有一道**编译期穷尽检查**
  （`@omni/store` 的 `Handlers` 从 `Event["type"]` 映射出来），新增一种忘了接会编译不过。
