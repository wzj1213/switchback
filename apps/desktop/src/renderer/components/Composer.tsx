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
 */
const TRUSTS: readonly { id: Trust; label: string; hint: string }[] = [
  { id: "read-only", label: "只读", hint: "任何写入与命令都拒绝" },
  { id: "auto-edit", label: "自动编辑", hint: "工作区内的改动直接放行，越界才问" },
  { id: "full", label: "完全访问", hint: "只在红线上问（工作区外、网络、不可逆操作）" },
]

interface Props {
  /** 回放出来的历史会话：背后没有引擎，只能读不能发。 */
  detached?: boolean
  /** 引擎还在起、或者上一轮还没跑完。**发不出去，而且要说出来为什么**。 */
  busy?: boolean
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
  /** 外面塞进来的文本（「改一改再发」）。`at` 变了才生效。 */
  prefill?: { text: string; at: number }
  onEngineChange: (engine: EngineId) => void
  onTrustChange: (trust: Trust) => void
  onSend: (text: string, attachments: readonly string[]) => void
  /** 让这个历史会话重新接上引擎 */
  onResume: () => void
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
  onModelChange,
  cwd,
  stamp,
  busy = false,
  onInterrupt,
  searchFiles,
  commands,
  onOmni,
  canAttach,
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
  /**
   * 现在能不能发。
   *
   * `busy` 覆盖两件事：引擎还在起（`starting`）、上一轮还没跑完。
   * **第二条是个真 bug 不是洁癖**：轮次跑着时再发一条，
   * Claude 那边正在流的回答会整个消失——审计里复现过。
   */
  // **跑着的时候照样能打、能发**——发出去是排队，这一轮停了就接上。
  // 只有「这是历史记录」才真的不能发（背后没有引擎）
  const blocked = detached
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
        <Attachments paths={attach.paths} onRemove={attach.remove} />
        {detached ? null : <Chips cwd={cwd} project={cwd.split("/").filter(Boolean).pop() ?? cwd} stamp={stamp} />}
        <Prompt
          value={text}
          detached={blocked}
          busyHint={busy && !detached}
          queueing={busy && !detached}
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
          empty={text.trim() === ""}
          engine={engine}
          engines={engines}
          trust={trust}
          models={models}
          model={model}
          effort={effort}
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

