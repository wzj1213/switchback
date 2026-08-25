import type { Thread } from "@omni/protocol"
import { withQueue, type Ctx, type Live } from "./ctx.js"

/**
 * 岔出来的那条会话**长什么样**。
 *
 * 从 `branch.ts` 拆出来是行数闸门逼的，但这一刀也顺：那边回答「怎么岔」
 *（读稳定事件、选原生还是空白、失败了怎么收场），这边只回答「岔出来那条是什么」。
 * 想给派生会话加一项继承规则，改这一个地方就够——**上一版那条规则散在一个
 * 六十行的函数中间，加一项要先把整段读完**。
 */

export interface BornSpec {
  to: string
  label: string
  /** 抄过来多少条 item。血缘边界靠它，对比时从这儿之后才算来源侧的新动作。 */
  kept: number
  at: number
  /** 岔出来之后放进输入框的话。见 `thread.rewind` 的 `draft`。 */
  draft?: { text: string; attachments?: readonly string[] }
}

/**
 * 岔出来的会话开场时输入框里有什么。
 *
 * 默认是干净的；只有「改一改再发」会带一句话过来。**必须连 `draftRevision` 一起给**：
 * 输入框靠那个身份认「这是新的一次要求」，不给的话那段文字进不去
 *（见 `Workspace` 的 `useDraft`）。
 */
function draftOf(
  ctx: Ctx,
  draft: { text: string; attachments?: readonly string[] } | undefined,
): Pick<Thread, "draft" | "draftAttachments" | "draftRevision"> {
  if (draft === undefined) {
    return { draft: undefined, draftAttachments: undefined, draftRevision: undefined }
  }
  const paths = draft.attachments ?? []
  return {
    draft: draft.text,
    draftRevision: ctx.deps.newId("dr"),
    ...(paths.length === 0 ? { draftAttachments: undefined } : { draftAttachments: [...paths] }),
  }
}

function forkBoundary(from: string, itemCount: number): Pick<Thread, "forkedFrom" | "forkedFromItemCount"> {
  return { forkedFrom: from as Thread["forkedFrom"], forkedFromItemCount: itemCount }
}

/** 按来源会话与这次分叉的意图，铸出新会话的初始形。 */
export function bornOf(ctx: Ctx, entry: Live, spec: BornSpec): Thread {
  return withQueue({
      ...entry.thread,
      id: ctx.deps.newId("th"),
      engine: spec.to,
      engineHistory: [spec.to],
      // 留着原会话句柄会在续跑时接回**原会话**
      engineHandle: undefined,
      engineProfile: spec.to === entry.thread.engine ? entry.thread.engineProfile : undefined,
      model: undefined,
      effort: undefined,
      // 新 thread 只继承对话血缘，不继承来源会话的原生身份与瞬时状态。
      // 否则切回某家时会续到父分支，或者把旧引擎的档位/能力画在新引擎上。
      segments: [],
      engineState: undefined,
      goal: undefined,
      trustApply: undefined,
      capabilities: undefined,
      nextEngine: undefined,
      passTurn: undefined,
      asides: [],
      ...draftOf(ctx, spec.draft),
      adopted: undefined,
      // 标题带上来路，否则侧栏里两个会话长得一模一样
      title: `${entry.thread.title}（${spec.label}）`,
      // 留下血缘，事后才对比得起来。**分叉的意义就在于能比**
      // 来源会话在这里之前都是共同历史；对比时从这个精确边界之后再算来源侧新动作。
      ...forkBoundary(entry.thread.id, spec.kept),
      detached: false,
      status: "idle",
      createdAt: spec.at,
      updatedAt: spec.at,
      /**
       * **派生出来的先算临时的**（和「+ 新建」同一条规矩，见 `Thread.provisional`）。
       *
       * 分叉与重来都是**探索性**动作：你想看看「换一家会怎么做」「回到那一轮重走一遍」。
       * 而上一版它一生出来就是一条正式记录——进侧栏、落盘、删不掉自己。于是
       * 「点一下看看，不满意」的代价是永久多一条历史，人为了不脏历史反而不敢点。
       *
       * 现在判据和别处完全一致：**跑过新的一轮才算数**（`prompt` 里 `commit()` 那一下）。
       * 抄过来的 transcript 不算——那是抄来的历史，不是这条会话干过的事。
       * 没用过就切走的话它被回收（`dropTemps`），磁盘上一个字都没有。
       * 想要回来？从同一个点再分一次，得到的东西一模一样。
       */
      provisional: true,
    }, [])
}
