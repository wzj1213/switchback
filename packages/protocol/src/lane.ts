import type { ItemId, ThreadId } from "./ids.js"

/**
 * 一条**旁路**：属于这条会话、但引擎明说了它不属于主线 transcript 的东西。
 *
 * ## 为什么侧问和编排进度是同一个概念
 *
 * 不是「我觉得像」，是各家自己的实现摆在那儿：
 *
 * - claude 用同一个 `skip_transcript` 标了侧问 / 后台任务 / workflow 三类，
 *   注释原文是「Consumers should hide this from the inline transcript; it may still
 *   appear in a tasks panel」——**引擎自己就假定宿主有一个独立面板**。
 * - codex 把三类全表达成「另一条 thread」（ephemeral fork / parent_thread_id / reviewThreadId）。
 * - grok 三类走同一条私有通知 `_x.ai/session_notification`。
 * - kimi 的 Web UI 已经用同一个侧面板渲染（`'compaction' | 'agent' | 'btw' | diff` 判别式）。
 *
 * 所以这一栏不是 omni 发明的分类，是照引擎给宿主的建议做的。
 */
export interface Lane {
  /**
   * 会话内唯一。活动旁路由驱动铸、宿主在 `item-scope` 里重铸成 omni 全局 id；
   * 侧问由宿主直接铸全局 id——它是用户发给 `EngineSession.askAside` 的控制请求，
   * 不经过驱动事件流。两条路最终都保证同一会话里不会互相覆盖。
   */
  id: string
  threadId: ThreadId
  /**
   * **两档，不是五档。**
   *
   * 界面上唯一真正的分歧是「这儿有没有输入框」：`aside` 能问，`activity` 只能看。
   * 再细分（workflow / subagent / 后台任务 / detached review）是**引擎自己的分类学**，
   * 界面不需要它——需要说明白的时候让 `title` 说。
   * 多分一档，就多一处接第五家时要改的地方（同 `EngineCapabilities` 的理由）。
   */
  kind: "aside" | "activity"
  /**
   * 给人看的一句话。活动旁路由**引擎自己写**，omni 不从工具名拼一句顶替；
   * 侧问则是用户自己输入的问题。两者都不是 omni 代写的模型内容。
   */
  title: string
  /** 暂停不是失败，也不能继续转圈；保留独立状态才能如实镜像原生 workflow / task。 */
  status: "running" | "paused" | "done" | "failed"
  /**
   * **这条旁路是什么时候开始的**，不是最后一次更新的时刻。
   *
   * 界面按它把卡片插进转录区（同侧问：你起这一批的时候屏幕停在哪儿，它就该留在哪儿）。
   * 跟着更新走的话，一条跑十分钟的 workflow 会在对话里**一路往下爬**。
   * 驱动可以每帧都填当前时间，归约器只认第一次的（见 `store` 的 `lane.updated`）。
   */
  at: number
  /**
   * 一句话结论（子 agent 的最终报告、侧问的原生答案或原始错误）。
   * 远程全量重建时它优先于 items——那边可能还没收到这条 lane 的正文。
   */
  summary?: string
  /**
   * 进度树。**这条 lane 内部的扁平节点表**，不是每个节点一条 Lane。
   * 报不上来就缺席——缺席时界面画转圈，不画一条永远 0% 的进度条。
   */
  progress?: LaneProgress
  /**
   * 引擎侧的句柄：codex 是子 thread id，grok 是 child_session_id，claude 是 task_id。
   * **omni 只原样存取，不解释它**——和 `Thread.engineHandle` 同一条规矩。
   */
  handle?: string
  /**
   * 这条旁路跑的**命令原文**，引擎自己上报的那一份（Kimi 的后台任务帧带 `command`）。
   *
   * 没有它的时候，一条后台任务在界面上只剩「标题 + 已完成」——而标题是模型写的一句话，
   * 看不出它到底跑了什么、在哪儿跑的。实测一条会话里 14 条后台任务全长这样，
   * 用户的原话是「莫名其妙有一堆，也不知道是啥东西」。
   *
   * **只收引擎自报的原文**：不从工具调用里反推，不替引擎拼一条命令出来。
   * 报不上来就缺席，界面照旧只画标题。
   */
  command?: string
}

/**
 * **全量快照，REPLACE 语义。**
 *
 * 和 `item.updated` 携带整条 item 是同一个取舍：节点表很小，全量替换换来
 * 「渲染层永远不需要做补丁合并」。而且三家给的本来就是快照
 *（claude 的 `workflow_progress` 全量、grok 的 `WorkflowUpdated` 带单调 `revision`、
 * codex 的 `turn/plan/updated` 全量）。做增量补丁是在发明一个没人需要的合并逻辑。
 */
export interface LaneProgress {
  nodes: readonly LaneNode[]
  /** 花了多少、上限多少。报不上来就缺席，界面不猜一个分母。 */
  budget?: { used: number; total?: number }
}

export interface LaneNode {
  /** 支线内唯一即可。 */
  id: string
  label: string
  /**
   * 缺席 = 挂在根上。**树形只靠这一条**，不要再发明第二种表达。
   *
   * 三家上游本来就是扁平的：claude 的 `workflow_phase{index}` + `workflow_agent{phaseIndex}`、
   * grok 的 `agents[]` 每个带 `phase`、codex 的 `agent_path` 是 `/root/worker` 路径串。
   * 硬拗成嵌套等于替三家做一次它们都没做的转换。
   */
  parent?: string
  state: "pending" | "running" | "done" | "failed" | "skipped"
  /** 最近一步在干什么，一行。引擎给不出就缺席。 */
  detail?: string
  /** 这个节点烧了多少 token。给不出就缺席——**不显示 0**，那是在说「它没花钱」。 */
  tokens?: number
}

/**
 * 这条 item **不属于主线**，属于哪条旁路。**缺席 = 主线。**
 *
 * ## 为什么是 `ItemBase` 上的一等字段
 *
 * 1. **不是新的 `ItemKind`**：`protocol/README.md` 的「已知限制」写着新增一种就要动
 *    两端所有渲染分支，那是**有意的摩擦**。而旁路里的内容和主线里的内容本来就是
 *    同一种东西——侧问的回答就是 `agent_message`，子 agent 的调用就是 `tool_call`。
 *    为侧栏发明第二套 item 类型等于把整套渲染写两遍。
 * 2. **也不该进 `meta`**：那个抽屉的契约是「厂商特有字段，读之前自己判类型」，
 *    而 lane 归属是 omni 自己的一等概念、是渲染层每一帧的主分流轴。
 * 3. **可选字段**：老日志回放时缺席，全部落主线，不需要迁移。
 */
export interface LaneRef {
  id: string
  /**
   * 挂在哪个工具调用下。主 transcript 靠它在那一行工具上画「在旁路查看」——
   * 旁路内容被抽走之后，主线上会剩一条**看不出发生过什么**的工具行，
   * 那比不抽更让人迷惑。**侧问不留锚点**：它本来就不该在主线上留痕迹。
   */
  originItemId?: ItemId
}
