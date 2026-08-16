import type { EngineId, ItemId, ThreadId, TurnId } from "./ids.js"
import type { Trust } from "./thread.js"

/** 渲染层 → 宿主的反向指令。宿主是唯一执行者，渲染层不直接碰引擎进程。 */
export type Command =
  | {
      type: "thread.create"
      cwd: string
      engine: EngineId
      trust: Trust
      title?: string
      /** 不给就是项目会话。见 `Thread.workspaceKind`。 */
      workspaceKind?: "project" | "chat"
    }
  | { type: "thread.prompt"; threadId: ThreadId; text: string; attachments?: readonly string[] }
  | { type: "thread.interrupt"; threadId: ThreadId }
  /**
   * 撤回排着队还没发出去的话。**不动正在跑的那一轮**——
   * 「我改主意了，那句不用发了」和「停下」是两件事。
   */
  | { type: "thread.unqueue"; threadId: ThreadId }
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
   * 所以走一条诚实的路：**开一个新会话，把那一轮之前的内容作为交接包喂进去**，
   * 原会话原样留着。你得到的是「带着当时的上下文重新开始」，
   * 而不是一个假装什么都没发生过的会话。
   */
  | { type: "thread.rewind"; threadId: ThreadId; turnId: TurnId }
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
   * L3 分叉：把同一个目标交给另一家引擎**另起一个会话**跑一遍。
   * 与接力（L2）的区别是原会话**继续存在**，两边可以对着看。
   */
  | { type: "thread.fork"; threadId: ThreadId; to: EngineId }
  /** 换模型 / 改推理强度。`effort` 只对报了 `efforts` 的引擎有意义。 */
  | { type: "thread.setModel"; threadId: ThreadId; model: string; effort?: string }
  /** L2 接力：换引擎继续同一个 thread，宿主负责生成交接包。 */
  | { type: "thread.handoff"; threadId: ThreadId; to: EngineId }
  | { type: "approval.resolve"; itemId: ItemId; allow: boolean; remember: RememberScope }

/** 记忆范围。`project` 级会落盘并跨会话生效；红线项不允许 `project`。 */
export type RememberScope = "once" | "session" | "project"
