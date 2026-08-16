import { useState } from "react"
import { Prompt } from "./Prompt.js"
import { Action, takeCommand } from "./ComposerAction.js"
import { ModelPicker } from "./ModelPicker.js"
import { Select } from "./Select.js"
import { Chips } from "./Chips.js"
import { EngineIcon, ShieldIcon } from "./icons.js"
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
  commands,
  onOmni,
}: Props): React.JSX.Element {
  const [text, setText] = useState("")
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
          queueing={busy && !detached}
          cwd={cwd}
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

/**
 * 输入框下面那一排：引擎 / 信任档 / 模型 ＋ 右下角那颗键。
 *
 * 从 `Composer` 拆出来是行数闸门逼的。边界还算清楚：上面是「打什么字」，
 * 这一排是「这句话由谁、以什么权限、用哪个模型去跑」——
 * 四件事都不改文本，只改**这句话的去向**。
 */
function Bar({
  detached,
  busy,
  empty,
  engine,
  engines,
  trust,
  models,
  model,
  effort,
  onEngineChange,
  onTrustChange,
  onModelChange,
  onResume,
  onInterrupt,
  onSend,
}: {
  detached: boolean
  busy: boolean
  empty: boolean
  engine: EngineId
  engines: readonly EngineInfo[]
  trust: Trust
  models: readonly ModelOption[]
  model?: string
  effort?: string
  onEngineChange: (next: EngineId) => void
  onTrustChange: (next: Trust) => void
  onModelChange: (model: string, effort?: string) => void
  onResume?: () => void
  onInterrupt?: () => void
  onSend: () => void
}): React.JSX.Element {
  return (
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
              empty={empty}
              onResume={onResume}
              onInterrupt={onInterrupt}
              onSend={onSend}
            />
          </div>
  )
}
