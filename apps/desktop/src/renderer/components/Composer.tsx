import { useEffect, useRef, useState } from "react"
import { Prompt } from "./Prompt.js"
import { takeCommand } from "./ComposerAction.js"
import { Chips } from "./Chips.js"
import { Attachments } from "./Attachments.js"
import { Bar } from "./ComposerBar.js"
import { useAttachments } from "../useAttachments.js"
import type { EngineId, EngineInfo, ModelOption, SlashCommand, Trust } from "@omni/protocol"

/**
 * 信任档。
 *
 * `hint` 不是可有可无的：这三个词说得出**档位叫什么**，说不出
 * **它到底会不会问我**。而这正是用户在改这个控件时唯一关心的事。
 *
 * ## 为什么中间那档不再叫「自动编辑」
 *
 * 它原来的说明是「工作区内的改动直接放行，越界才问」。那句话对 codex
 *（真的 OS 沙箱）和 Claude（每次工具调用都经过 omni）成立，对讲 ACP 的那两家
 * **根本不成立**：这一档落到 Kimi 是它自己的 Auto 档、落到 Grok 是 yolo，
 * **「什么算安全」由引擎自己判**。实测 Kimi 认为 `cat .env` 属于安全操作，
 * 直接跑了，omni 全程没被问过——而界面上写着「越界才问」。
 *
 * 选择是「保持原生」：不把引擎切到每次都问 omni 的档位（那会丢掉它自己那套
 * 判断，也丢掉它的速度），而是**把名字改成实话**。档位 id 不动
 *（`auto-edit` 落在 journal 里，改 id 等于让历史会话读不回来）。
 *
 * 只读那一档反过来是**四家都硬**的：Kimi 的 plan 压根不执行工具、
 * Grok 会来问而 omni 直接拒、codex 是只读沙箱、Claude 走 omni 的判定。
 * 所以它值得被说成「硬的」——现在只有它当得起这句话。
 */
const TRUSTS: readonly { id: Trust; label: string; hint: string }[] = [
  { id: "read-only", label: "只读", hint: "不写文件、不跑命令。四家引擎在这一档上都是硬的" },
  { id: "auto-edit", label: "引擎自动", hint: "什么算安全由引擎自己判（Kimi 的 Auto、Codex 的工作区沙箱）" },
  { id: "full", label: "全部放行", hint: "最宽的一档。Kimi 与 Grok 在这一档下什么都不问" },
]

interface Props {
  /** 回放出来的历史会话：背后没有引擎，只能读不能发。 */
  detached?: boolean
  /** 引擎还在起、或者上一轮还没跑完。**发不出去，而且要说出来为什么**。 */
  busy?: boolean
  /** 引擎还在起。**和 `busy` 不是一回事**：那时什么都没在跑，而且发不出去。 */
  starting?: boolean
  /** busy 时「发送」变成「停止」，点它中断当前轮次。 */
  onInterrupt?: () => void
  engine: EngineId
  /** 可选引擎。**由宿主给**，不在这里写死——写死的那份迟早和真正注册了的对不上。 */
  engines: readonly EngineInfo[]
  trust: Trust
  /** 可选模型。空数组时不显示选择器——没得选就别摆一个空下拉。 */
  models: readonly ModelOption[]
  /** 当前模型；undefined 表示用引擎自己的默认 */
  model: string | undefined
  effort: string | undefined
  /**
   * 有待切换的引擎时它的名字。**模型选择器据此变成一句说明**——
   * 手上这份清单是旧那家报的，不能让人挑，但也不该凭空消失。
   */
  pending?: string
  onModelChange: (model: string, effort?: string) => void
  /** 工作区绝对路径，`@` 文件引用要用 */
  cwd: string
  /** 轮次状态。变一次芯片就重新问一遍 git——引擎改完文件之后「脏不脏」就变了。 */
  stamp: string
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
  /** 能用的斜杠命令：引擎报的 ＋ omni 自己的，`Workspace` 拼好再给。 */
  commands: readonly SlashCommand[]
  /** 选中了一条 omni 自己的命令（`source === "omni"`），就地执行。 */
  onOmni: (name: string) => void
  /** 这家引擎收不收附件。不收就不给贴图入口。 */
  canAttach: boolean
  /**
   * 这家引擎能不能**跑到一半改向**。
   *
   * 只影响一句提示词，但那句话说的是两件完全不同的事：能改向的话你现在打的
   * 立刻起作用，不能的话要等这一轮跑完。说错了比不说更糟——用户会照着
   * 「立刻起作用」的预期去打断自己已经跑了两分钟的活。
   */
  canSteer: boolean
  /** 外面塞进来的文本（「改一改再发」）。`at` 变了才生效。 */
  prefill?: { text: string; at: number }
  onEngineChange: (engine: EngineId) => void
  onTrustChange: (trust: Trust) => void
  onSend: (text: string, attachments: readonly string[]) => void
  /** 让这个历史会话重新接上引擎 */
  onResume: () => void
}

/**
 * 输入区现在处在哪一档。**四档互斥**，而且各有各的文案和右下角那颗键：
 * 历史记录 / 引擎还在起 / 跑着但能插话 / 跑着只能排队。
 *
 * 拎出来是复杂度闸门逼的，但边界也对：这是一次判定，不是渲染。
 */
function stateOf(o: { detached: boolean; starting: boolean; busy: boolean; canSteer: boolean }): {
  blocked: boolean
  queueing: boolean
  steering: boolean
} {
  const running = o.busy && !o.detached
  return {
    // 真正发不出去的只有两种：这是历史记录（背后没有引擎），
    // 以及**引擎还没起来**——后者不禁的话，回车会先清空输入框、
    // 再撞上宿主那句「会话不存在」，打好的一句话就这么没了
    blocked: o.detached || o.starting,
    queueing: running && !o.canSteer,
    steering: running && o.canSteer,
  }
}

export function Composer({
  detached = false,
  engine,
  engines,
  trust,
  onEngineChange,
  onTrustChange,
  onSend,
  onResume,
  models,
  model,
  effort,
  pending,
  onModelChange,
  cwd,
  stamp,
  busy = false,
  starting = false,
  onInterrupt,
  searchFiles,
  commands,
  onOmni,
  canAttach,
  canSteer,
  prefill,
}: Props): React.JSX.Element {
  const [text, setText] = useState("")
  // 引擎不支持附件就整套不出现——一个贴上去不会被送达的图比不能贴更糟
  const attach = useAttachments(canAttach)
  // **只认序号变化，不认文本变化。** 依赖文本的话，用户在输入框里把它改回原样，
  // 这个 effect 会再跑一次、把光标弹到末尾
  const seen = useRef(prefill?.at ?? 0)
  useEffect(() => {
    if (prefill === undefined || prefill.at === seen.current) return
    seen.current = prefill.at
    setText(prefill.text)
  }, [prefill])
  // **跑着的时候照样能打、能发**——发出去是排队，这一轮停了就接上
  const { blocked, queueing, steering } = stateOf({ detached, starting, busy, canSteer })
  const submit = (): void => {
    const trimmed = text.trim()
    // **只有附件、没有文字也该能发**：贴一张报错截图问「这是怎么回事」，
    // 那句话经常就在图里
    if ((trimmed === "" && attach.paths.length === 0) || blocked) return
    onSend(trimmed, attach.paths)
    setText("")
    attach.clear()
  }

  return (
    <div className="composer">
      <div
        className="composer__inner"
        onDragOver={(e) => {
          if (canAttach) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!canAttach) return
          e.preventDefault()
          attach.drop(e.dataTransfer.files)
        }}
      >
        {detached ? null : <Chips cwd={cwd} project={cwd.split("/").filter(Boolean).pop() ?? cwd} stamp={stamp} />}
        {/* 附件排在芯片**下面**、正文上面。芯片说的是「这句话会发到哪儿去」，
            是这一块的抬头，得钉在最上面；而附件是这句话的一部分，紧挨着正文才对。
            反过来放的话，贴一张图就把抬头顶下去 72 像素 */}
        <Attachments paths={attach.paths} onRemove={attach.remove} />
        <Prompt
          value={text}
          detached={detached}
          starting={starting}
          queueing={queueing}
          steering={steering}
          cwd={cwd}
          onPaste={attach.paste}
          commands={commands}
          onCommand={(command) => {
            takeCommand(command, setText, onOmni)
          }}
          searchFiles={searchFiles}
          onChange={setText}
          onSubmit={submit}
        />
        <Bar
          detached={detached}
          busy={busy}
          starting={starting}
          empty={text.trim() === ""}
          engine={engine}
          engines={engines}
          trust={trust}
          models={models}
          model={model}
          effort={effort}
          pending={pending}
          onEngineChange={onEngineChange}
          onTrustChange={onTrustChange}
          onModelChange={onModelChange}
          onResume={onResume}
          onInterrupt={onInterrupt}
          onSend={submit}
        />
      </div>
    </div>
  )
}

/** 引擎/档位 id → 展示名。顶栏、导出、菜单都要用同一套措辞。 */
export function labelOf<T extends { id: string; label: string }>(list: readonly T[], id: string): string {
  return list.find((x) => x.id === id)?.label ?? id
}

export { TRUSTS }

