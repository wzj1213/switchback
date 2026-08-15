import { useState } from "react"
import { Prompt } from "./Prompt.js"
import { ModelPicker } from "./ModelPicker.js"
import { Select } from "./Select.js"
import { Chips } from "./Chips.js"
import { EngineIcon, SendIcon, ShieldIcon, StopIcon } from "./icons.js"
import type { EngineId, EngineInfo, ModelOption, Trust } from "@omni/protocol"

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
  onEngineChange: (engine: EngineId) => void
  onTrustChange: (trust: Trust) => void
  onSend: (text: string) => void
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
}: Props): React.JSX.Element {
  const [text, setText] = useState("")
  /**
   * 现在能不能发。
   *
   * `busy` 覆盖两件事：引擎还在起（`starting`）、上一轮还没跑完。
   * **第二条是个真 bug 不是洁癖**：轮次跑着时再发一条，
   * Claude 那边正在流的回答会整个消失——审计里复现过。
   */
  const blocked = detached || busy
  const submit = (): void => {
    const trimmed = text.trim()
    if (trimmed === "" || blocked) return
    onSend(trimmed)
    setText("")
  }

  return (
    <div className="composer">
      <div className="composer__inner">
        {detached ? null : <Chips cwd={cwd} project={cwd.split("/").filter(Boolean).pop() ?? cwd} stamp={stamp} />}
        <Prompt
          value={text}
          detached={blocked}
          busyHint={busy && !detached}
          cwd={cwd}
          searchFiles={searchFiles}
          onChange={setText}
          onSubmit={submit}
        />
        <div className="composer__bar">
          <Select
            label={labelOf(engines, engine)}
            icon={<EngineIcon />}
            title="引擎"
            disabled={detached}
            sections={[
              {
                value: engine,
                onPick: onEngineChange,
                // 探测出「没装」的**仍然可选**，只在右边加个记号：探测也会错，
                // 硬拦住一个其实能用的引擎比不检查更糟。真起不来时横幅会说原因
                choices: engines.map((item) => ({
                  id: item.id,
                  label: item.label,
                  ...(item.state === "missing" ? { note: "未安装" } : {}),
                  ...(item.detail === undefined ? {} : { description: item.detail }),
                })),
              },
            ]}
          />
          <Select
            label={labelOf(TRUSTS, trust)}
            icon={<ShieldIcon />}
            title="信任档"
            disabled={detached}
            sections={[
              {
                value: trust,
                onPick: (id) => {
                  onTrustChange(id as Trust)
                },
                choices: TRUSTS.map((item) => ({ id: item.id, label: item.label, description: item.hint })),
              },
            ]}
          />
          <ModelPicker
            models={models}
            model={model}
            effort={effort}
            disabled={detached}
            onChange={onModelChange}
          />
          <span style={{ flex: 1 }} />
          <Action
            detached={detached}
            busy={busy}
            empty={text.trim() === ""}
            onResume={onResume}
            onInterrupt={onInterrupt}
            onSend={submit}
          />
        </div>
      </div>
    </div>
  )
}

/** 引擎/档位 id → 展示名。顶栏、导出、菜单都要用同一套措辞。 */
export function labelOf<T extends { id: string; label: string }>(list: readonly T[], id: string): string {
  return list.find((x) => x.id === id)?.label ?? id
}

export { TRUSTS }

/**
 * 输入区右下角那一颗。**三种状态共用一个位置**：断开时是「继续这个会话」，
 * 跑着时是停止，其余时候是发送。手已经知道往哪儿点，换的是形状不是位置。
 */
function Action({
  detached,
  busy,
  empty,
  onResume,
  onInterrupt,
  onSend,
}: {
  detached: boolean
  busy: boolean
  empty: boolean
  onResume?: () => void
  onInterrupt?: () => void
  onSend: () => void
}): React.JSX.Element {
  if (detached) return <Resume onResume={onResume} />
  if (busy) {
    // 跑着的时候把「发送」换成「停止」而不是灰掉：**这时候人真正想按的是停止**，
    // 而一个灰掉的发送键只告诉他「不能发」，没告诉他还能做什么
    return (
      <button
        className="send send--stop"
        type="button"
        title="停止（Esc）"
        aria-label="停止"
        onClick={onInterrupt}
        disabled={onInterrupt === undefined}
      >
        <StopIcon />
      </button>
    )
  }
  return (
    <button className="send" type="button" title="发送（⌘↵）" aria-label="发送" onClick={onSend} disabled={empty}>
      <SendIcon />
    </button>
  )
}

/**
 * 「继续这个会话」——**点下去要立刻有反应**。
 *
 * 恢复会话得把引擎重新拉起来、握手、读回历史，几百毫秒到几秒不等。
 * 上一版点完按钮纹丝不动，于是人会再点一次、再点一次——命令层虽然去重了，
 * 但那是在**兜底**，不是在回应。按钮自己要说话。
 */
function Resume({ onResume }: { onResume?: () => void }): React.JSX.Element {
  const [going, setGoing] = useState(false)
  return (
    <button
      className="btn btn--primary"
      type="button"
      disabled={going || onResume === undefined}
      onClick={() => {
        setGoing(true)
        onResume?.()
      }}
    >
      {going ? "正在恢复…" : "继续这个会话"}
    </button>
  )
}
