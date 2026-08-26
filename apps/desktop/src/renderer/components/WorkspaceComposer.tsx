import type { Command, EngineInfo, Thread } from "@omni/protocol"
import { NO_CAPABILITIES } from "@omni/protocol"
import { Composer, TRUSTS, labelOf } from "./Composer.js"
import { trustBlind, trustHint } from "../trustHint.js"
import type { OmniAction } from "../omniCommands.js"
import type { WorkspaceProps } from "./Workspace.js"
import { modelAcceptsImages } from "../model-options.js"

/**
 * 把 `Thread` 上十几个字段翻成输入区要的 props。
 *
 * 从 `Workspace.tsx` 拆出来是行数闸门逼的（实测 199/200，只剩一行），
 * 但边界本来就在这儿：`Workspace` 管的是**这一屏由哪几块拼起来**，
 * 而「一条会话的状态怎么变成输入区的可用性」是另一件事——
 * 它几乎每个 prop 都带着一段「上一版为什么错」的理由，堆在布局代码中间读不动。
 */

function pendingEngine(
  thread: Thread,
  engines: readonly EngineInfo[],
  send: (command: Command) => void,
): { pending?: { label: string; onSwitchNow: () => void } } {
  const to = thread.nextEngine
  if (to === undefined) return {}
  return {
    pending: {
      label: labelOf(engines, to),
      onSwitchNow: () => {
        send({ type: "thread.switchNow", threadId: thread.id })
      },
    },
  }
}

export function WorkspaceComposer({
  props,
  thread,
  stamp,
  prefill,
  actions,
}: {
  props: WorkspaceProps
  thread: Thread
  stamp: string
  prefill: { text: string; attachments?: readonly string[]; at: number; aside?: boolean }
  actions: readonly OmniAction[]
}): React.JSX.Element {
  const send = props.send
  return (
    <Composer
      threadId={thread.id}
      drafts={props.drafts}
      detached={thread.detached === true}
      /* **和当前轮次比一比才算数**：`passTurn` 存的是轮次 id，
         所以「过期」不需要谁记得来清一次——下一轮的 id 不一样，这里自然就是 false */
      passing={thread.passTurn !== undefined && thread.passTurn === props.turn?.id}
      /*
       * **启动期和「上一轮还在跑」是两回事**，上一版把它们并成一个 `busy`，
       * 于是引擎还没起来时屏幕上写着「它还在跑——现在打的会排在后面」，
       * 而其实什么都没在跑；更糟的是输入框没被禁，回车会先清空文本、
       * 再撞上宿主那句「会话不存在」——**那条消息就这么没了**。
       */
      starting={thread.status === "starting"}
      busy={props.turn !== undefined}
      onInterrupt={() => {
        send({ type: "thread.interrupt", threadId: thread.id })
      }}
      engines={props.engines}
      cwd={thread.cwd}
      stamp={stamp}
      searchFiles={props.searchFiles}
      prefill={prefill}
      canAttach={(thread.capabilities ?? NO_CAPABILITIES).attachments &&
        modelAcceptsImages(props.models, thread.model)}
      canSteer={(thread.capabilities ?? NO_CAPABILITIES).steer}
      commands={[...actions.map((a) => a.command), ...props.commands]}
      onOmni={(name: string) => {
        actions.find((a) => a.command.name === name)?.run()
      }}
      /*
       * 档位下面那行说明。**引擎名与档位名都是插值**——写死的话换一家引擎那句就在撒谎。
       * 权限描述当前**实际活着**的原生会话；nextEngine 只是下一句意向，切换前不能提前冒充。
       */
      hint={trustHint(thread, labelOf(props.engines, thread.engine), labelOf(TRUSTS, thread.trust))}
      blind={trustBlind(thread, labelOf(props.engines, thread.engine))}
      /*
       * 侧问。**入口不再是那一排里的一颗按钮**——那一排说的是「正文这一句的去向」，
       * 而一颗打开另一条通道的按钮站在那儿，就成了那排唯一带描边的东西。
       * 现在是 `/侧问` 或 `⌥⌘↩`（见 `use-aside-mode.ts`）。
       *
       * **还没说过一句话的会话不给**：侧问的定义是「不打断主线」，
       * 而这时根本没有主线——那一屏还写着「在 xxx 里做点什么？」。
       * `provisional` 正是「发出第一句话之前」（见 `Thread.provisional`）。
       */
      canAside={(thread.capabilities ?? NO_CAPABILITIES).sideQuestion && thread.provisional !== true}
      onAsk={(text) => {
        send({ type: "thread.sideQuestion", threadId: thread.id, text })
      }}
      /*
       * 有待切换的引擎时，模型选择器变成**一句点不动的说明**（「切到 Codex 后可选」）。
       * 手上这份清单是**旧那家**报的，它的模型 id 在新的一家那里通常根本不存在，
       * 所以确实不能挑；但上一版是把整个控件藏起来，而一个凭空消失的控件
       * 读起来就是坏了——用户的原话是「切换别的引擎一个模型都不显示」。
       *
       * 只有**开过工的会话**会走到这里：还没说过话的临时会话切引擎是当场切的
       *（见 `Thread.provisional`），那时新那家的清单直接就来了。
       */
      models={props.models}
      model={thread.model}
      effort={thread.effort}
      usage={props.usage}
      {...pendingEngine(thread, props.engines, send)}
      onModelChange={(model, effort) => {
        send({ type: "thread.setModel", threadId: thread.id, model, ...(effort === undefined ? {} : { effort }) })
      }}
      // 两个选择器都读**当前会话**的真实值。各存一份局部状态的话，
      // 顶栏写着 Codex、选择器写着 Claude Code——一个会撒谎的控件比没有更糟。
      //
      // `nextEngine` 优先：切引擎现在是「下一句用它」，真正的切换发生在
      // 发出第一句话的时候（见 `Thread.nextEngine`）。选择器要显示**你选的那家**
      // ——显示旧的那家等于告诉他「没选上」。
      engine={thread.nextEngine ?? thread.engine}
      trust={thread.trust}
      onEngineChange={(next) => {
        // **中途接力**：同一个会话换一家引擎接着做，不是另开一个。
        // 历史留在原地；**切回去会续上那一家自己的那条 session**（见 `Thread.segments`），
        // 而不是每次都新开——codex 跑了一半、去 Claude 看一眼再回来，
        // 它该还记得自己做过什么。
        send({ type: "thread.handoff", threadId: thread.id, to: next })
      }}
      onTrustChange={(next) => {
        send({ type: "thread.setTrust", threadId: thread.id, trust: next })
      }}
      onSend={(text, attachments, steer) => {
        send({
          type: "thread.prompt",
          threadId: thread.id,
          text,
          ...(attachments.length === 0 ? {} : { attachments }),
          ...(thread.draftRevision === undefined ? {} : { draftRevision: thread.draftRevision }),
          // 只在真要插的时候带这一项：不带 = 排队（见 protocol 的 `steer`）
          ...(steer ? { steer: true } : {}),
        })
      }}
      onResume={() => {
        send({ type: "thread.resume", threadId: thread.id })
      }}
    />
  )
}
