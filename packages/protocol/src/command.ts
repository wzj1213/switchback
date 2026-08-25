import type { EngineId, ItemId, ThreadId, TurnId } from "./ids.js"
import type { Trust } from "./thread.js"

/** 渲染层 → 宿主的反向指令。宿主是唯一执行者，渲染层不直接碰引擎进程。 */
export type Command =
  /**
   * 把**引擎自己存的**一条会话接过来，在 omni 里接着聊。
   *
   * 和 `thread.resume` 的区别：那条是「omni 建过、记录在我这儿」的会话重新接上引擎；
   * 这条是「omni 从来不知道它存在」的会话——你在终端里、在别的界面里跑的。
   * 所以工作区、标题都得由调用方从引擎的列表里带过来。
   */
  /**
   * 问一句不打断主线的问题。**能力位报 false 的引擎上界面不给这个入口**，
   * 所以这条命令只会对报 true 的那家发出（见 `EngineCapabilities.sideQuestion`）。
   */
  | { type: "thread.sideQuestion"; threadId: ThreadId; text: string }
  | {
      type: "thread.adopt"
      engine: EngineId
      handle: string
      cwd: string
      title: string
      /** 原生历史属于哪个 profile；宿主不解释，只在续跑时原样带回。 */
      profile?: string
    }
  | {
      type: "thread.create"
      cwd: string
      engine: EngineId
      trust: Trust
      title?: string
      /** 不给就是项目会话。见 `Thread.workspaceKind`。 */
      workspaceKind?: "project" | "chat"
      /**
       * 开出来就用这个模型/思维档，而不是引擎的默认。
       *
       * **在建的时候给，而不是建完再 `thread.setModel`**：后者中间有一个窗口,
       * 那期间会话已经能发消息了，抢在里面发出去的第一句会跑在默认模型上——
       * 而用户明明在新建之前就把模型挑好了。
       *
       * 引擎不认这个模型的话由引擎报错，omni 不预先过滤（见 `main/settings.ts`
       * 里 `lastUsed` 那段：白名单在引擎那边，抄一份必然过期）。
       */
      model?: string
      effort?: string
    }
  | {
      type: "thread.prompt"
      threadId: ThreadId
      text: string
      attachments?: readonly string[]
      /**
       * 输入区当前承载的宿主草稿身份。只有身份仍相同时，这次发送才消费草稿。
       *
       * 这不是幂等键：它专门防止一条更早开始、后来才完成的跨引擎发送，
       * 把用户在等待期间刚从队列取回的新草稿清掉。
       */
      draftRevision?: string
      /**
       * 上一轮还在跑时，**这句话要不要当场插进去**。
       *
       * 不给（默认）＝ 排队，等这一轮停了再发。给 `true` ＝ 递进正在跑的那一轮，
       * 立刻生效（引擎得支持 `capabilities.steer`，不支持就退回排队）。
       *
       * ## 为什么默认是排队，而不是「能插就插」
       *
       * 上一版默认当场插——**和 codex 自己的行为正好相反**：你在它的界面里
       * 打字回车，那句是排着的，要再点一下「调整方向」才插进去。
       * 两边不一致的代价不是别扭，是**你以为在排队的那句话已经改变了它正在做的事**。
       *
       * 所以对齐：默认排队，插入是一个明确的动作（⌘⏎ 直接发，或者点排队条上的「立刻插入」）。
       */
      steer?: boolean
    }
  | { type: "thread.interrupt"; threadId: ThreadId }
  /**
   * 撤回排着队还没发出去的话。**不动正在跑的那一轮**——
   * 「我改主意了，那句不用发了」和「停下」是两件事。
   *
   * `index` 指定撤回队列里的**哪一条**（从 0 起）。**缺席＝整条队列一起撤回**。
   *
   * 上一版没有这个字段，于是撤回只有「全部」一种粒度，而且取回的几句会被
   * `\n` 拼成一段草稿——**拼完就再也分不开了**。排两句以上时那基本等于不能改主意：
   * 你想拿回第二句，代价是第一句也被拽下来、还和它粘在一起。
   */
  | { type: "thread.unqueue"; threadId: ThreadId; index?: number }
  /**
   * 把排着队的话**现在就插进正在跑的那一轮**。
   *
   * 和「等这一轮跑完再发」是两条不同的路，而它们的差别恰恰在最要紧的场合上：
   * 排着的那句往往是「别再往下走了」——等它跑完再说等于白说。
   *
   * 引擎不支持改向、或者那一轮刚好收工时，队列原样留着（下一轮自然会发）。
   */
  | { type: "thread.steerQueued"; threadId: ThreadId }
  /**
   * 压缩上下文：让引擎把前面的对话总结掉，腾出窗口继续。
   *
   * **只有引擎自己能做**——它才知道哪些能扔、总结成什么样喂回去不会失真。
   * omni 只负责给一个入口。
   */
  | { type: "thread.compact"; threadId: ThreadId }
  /**
   * 从某一轮**之前**重来：新开一个会话，只带上那一轮之前的上下文。
   *
   * ## 为什么是「新开一个」而不是真的把历史砍掉
   *
   * 因为**引擎不会忘**。会话的真实状态在引擎那边（codex 有 rollout 文件、
   * Claude 有 session），omni 删掉自己这边的记录改变不了它——
   * 那样只会造出一个「界面上看不见、模型却还记得」的分裂状态，
   * 比不给这个功能糟得多。
   *
   * 所以只在引擎暴露原生 fork 时开放：**开一个新会话，让引擎自己复制并回滚
   * 到那一轮之前**，原会话原样留着。做不到就明确失败，不注入摘要，
   * 也不拿空白会话冒充「带着上下文重来」。
   */
  | { type: "thread.rewind"; threadId: ThreadId; turnId: TurnId }
  /**
   * **现在就把待切换的引擎换过去**，不等下一句话。
   *
   * 「下一句生效」（`Thread.nextEngine`）是对的默认：点一下下拉不该当场停掉一个
   * 跑着上下文的引擎。但它有个说不过去的副作用——**换过去之前挑不了新那家的模型**，
   * 因为模型清单是引擎起来之后自己报的，而它还没起来。于是界面上只能摆一句
   * 「切到 Grok 后可选」，而用户明明已经选了 Grok。
   *
   * 所以给一条显式的路：他要现在挑模型，就现在切。**不改默认，只是把
   * 「我确实要现在切」这句话变得说得出口。**
   */
  | { type: "thread.switchNow"; threadId: ThreadId }
  | { type: "thread.setTrust"; threadId: ThreadId; trust: Trust }
  /**
   * 改名。**历史会话也能改**——恰恰是历史会话最需要，
   * 因为默认标题取自第一句提问，而回头找它的时候你想的是「那个改分页的」。
   */
  | { type: "thread.rename"; threadId: ThreadId; title: string }
  /** 让一个从磁盘回放出来的会话重新接上引擎，带着引擎那边的历史继续。 */
  | { type: "thread.resume"; threadId: ThreadId }
  /** 关掉会话并把它的记录从磁盘上删掉。**不可撤销**，界面必须二次确认。 */
  | { type: "thread.delete"; threadId: ThreadId }
  /**
   * L3 分叉：用目标引擎另开一条同工作区的相关会话，原会话继续存在。
   * 不自动发送文本；同引擎支持原生 fork 时可复制上下文，否则新分支为空白。
   */
  | { type: "thread.fork"; threadId: ThreadId; to: EngineId }
  /** 换模型 / 改推理强度。`effort` 只对报了 `efforts` 的引擎有意义。 */
  | { type: "thread.setModel"; threadId: ThreadId; model: string; effort?: string }
  /** L2 接力：换引擎继续同一个 thread；不翻译上下文，也不替用户注入提示词。 */
  | { type: "thread.handoff"; threadId: ThreadId; to: EngineId }
  /**
   * 落定一张审批卡。
   *
   * `passTurn` 是**这一轮剩下的都别再问了**（只在 `allow` 时有意义）。
   * 它不是一条记忆规则——没有模式、不落盘、轮次一结束就没了。
   * 之所以要有它：一轮里 agent 会为八件**各不相同**的事各问一次，
   * 而「允许此对话」是按模式记的，挡不住下一件不一样的事。
   *
   * **红线不受它影响**，照旧一条条问（见 `host/approval.ts`）。
   */
  | { type: "approval.resolve"; itemId: ItemId; allow: boolean; remember: RememberScope; passTurn?: boolean }

/** 记忆范围。`project` 级会落盘并跨会话生效；红线项不允许 `project`。 */
export type RememberScope = "once" | "session" | "project"
