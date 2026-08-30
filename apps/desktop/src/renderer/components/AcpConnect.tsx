import { useState } from "react"
import { bridge } from "../use-async.js"
import { Actions, Field } from "./SettingsBits.js"

/**
 * 接一家 omni 还不认识的 ACP 引擎。
 *
 * ## 为什么是「先试再写」，不是「填个表单存下来」
 *
 * 手写 `engines.json` 的问题不在于要写 JSON，在于**写对了才知道对**：
 * 写错的结果是一条起不来的会话，而错在哪不知道（命令名？参数？根本不讲 ACP？）。
 *
 * ACP 是有协议的，这个问题它自己能回答。所以这里先发一次 `initialize`——
 * **答得上来才让你接**，答不上来那句话也是它自己说的。
 * 命令和参数由你给，能力由握手探到，omni 一条都没编。
 *
 * ## 为什么不替你猜参数
 *
 * 各家进 ACP 模式的写法都不一样（`codex-acp` 直接跑、grok 是 `agent stdio`、
 * 有的要 `--experimental-acp`）。omni 内置一张猜出来的表，只会让另一台机器上的人
 * 点了就崩——而那条命令 omni 根本没有能力维护。失败时那句话会提到这一点，
 * 让你去它自己的文档里找，而不是让 omni 假装知道。
 */
interface Trial {
  ok: boolean
  protocolVersion?: number
  capabilities?: readonly string[]
  error?: string
  stderr?: string
}

export function AcpConnect(): React.JSX.Element {
  const omni = bridge()
  const [command, setCommand] = useState("")
  const [args, setArgs] = useState("")
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [trial, setTrial] = useState<Trial | undefined>(undefined)
  const [note, setNote] = useState<string | undefined>(undefined)
  // **参数按空白切**：带空格的单个参数请自己写进 engines.json——
  // 在这儿实现一套引号解析，只会让人以为它和 shell 一样，而它不是
  const argv = args.split(/\s+/u).filter((one) => one !== "")

  const run = (job: Promise<void>): void => {
    setBusy(true)
    void job.finally(() => setBusy(false))
  }

  return (
    <div className="acp-add">
      <Inputs
        command={command}
        args={args}
        label={label}
        busy={busy}
        onCommand={setCommand}
        onArgs={setArgs}
        onLabel={setLabel}
        onBrowse={() => {
          run(
            (omni?.pickExecutable() ?? Promise.resolve(undefined)).then((path) => {
              if (path !== undefined) setCommand(path)
            }),
          )
        }}
      />
      <Actions>
        <button
          type="button"
          className="tbtn"
          disabled={busy || command.trim() === ""}
          title="发一次 ACP 的 initialize。只握手，不会开会话、也不会让它开始干活"
          onClick={() => {
            setTrial(undefined)
            setNote(undefined)
            run(
              (omni?.tryAcpEngine({ command: command.trim(), args: argv }) ??
                Promise.resolve({ ok: false, error: "没有可用的桥接。" })).then(setTrial),
            )
          }}
        >
          {busy ? "正在试…" : "试一下"}
        </button>
        <button
          type="button"
          className="tbtn"
          disabled={busy || trial?.ok !== true}
          title={trial?.ok === true ? "写进 engines.json 并当场接上" : "先试通过再接"}
          onClick={() => {
            const named = label.trim() === "" ? command.trim() : label.trim()
            run(
              (omni?.addAcpEngine({
                name: named,
                label: named,
                command: command.trim(),
                args: argv,
              }) ?? Promise.resolve({ ok: false, error: "没有可用的桥接。" })).then((done) => {
                setNote(done.ok ? `已接入 ${done.id ?? named}，现在就能在引擎里选它。` : done.error)
                // 接完把表单清空：留着上一条会让人以为还没提交，然后再点一次
                //（第二次会撞上「已经有一条叫 X 的了」，看起来像出了错）
                if (done.ok) {
                  setCommand("")
                  setArgs("")
                  setLabel("")
                  setTrial(undefined)
                }
              }),
            )
          }}
        >
          接入
        </button>
      </Actions>
      <TrialResult trial={trial} note={note} />
    </div>
  )
}

/**
 * 三个输入。抽出去是行数闸门逼的，但边界也对：上面那个管「怎么试、怎么接」，
 * 这里只管「填什么」。
 */
function Inputs({
  command,
  args,
  label,
  busy,
  onCommand,
  onArgs,
  onLabel,
  onBrowse,
}: {
  command: string
  args: string
  label: string
  busy: boolean
  onCommand: (next: string) => void
  onArgs: (next: string) => void
  onLabel: (next: string) => void
  onBrowse: () => void
}): React.JSX.Element {
  return (
    <>
      <Field label="可执行文件" hint="命令名或绝对路径。装在 PATH 上的直接写名字" stack>
        <div className="acp-add__row">
          <input
            className="set__input"
            value={command}
            placeholder="zcode-acp-server"
            onChange={(e) => onCommand(e.target.value)}
          />
          <button type="button" className="tbtn" disabled={busy} onClick={onBrowse}>
            浏览…
          </button>
        </div>
      </Field>
      <Field label="参数" hint="进 ACP 模式要带的那几个；不用就空着。各家写法不同，看它自己的文档" stack>
        <input
          className="set__input"
          value={args}
          placeholder="agent stdio"
          onChange={(e) => onArgs(e.target.value)}
        />
      </Field>
      <Field label="显示名" hint="留空就用可执行文件的名字" stack>
        <input
          className="set__input"
          value={label}
          placeholder="ZCode"
          onChange={(e) => onLabel(e.target.value)}
        />
      </Field>
    </>
  )
}

/** 试接结果。**成功和失败都要说得具体**——「不可用」等于什么都没说。 */
function TrialResult({ trial, note }: { trial?: Trial; note?: string }): React.JSX.Element | null {
  if (note !== undefined) return <p className="set__blank">{note}</p>
  if (trial === undefined) return null
  if (!trial.ok) {
    return (
      <>
        <p className="set__blank set__blank--error" role="alert">
          {trial.error ?? "试接失败。"}
        </p>
        {/* **它自己打的那几行是唯一的线索**，别吞掉 */}
        {trial.stderr === undefined ? null : <pre className="set__log">{trial.stderr.slice(-1200)}</pre>}
      </>
    )
  }
  const caps = trial.capabilities ?? []
  return (
    <p className="set__blank">
      握手成功{trial.protocolVersion === undefined ? "" : `（ACP v${String(trial.protocolVersion)}）`}。
      {caps.length === 0 ? "它没有声明任何能力——那只是没声明，不代表不行。" : `它认领了：${caps.join("、")}。`}
    </p>
  )
}
