import { useState } from "react"
import type { EngineVersion, UpdateResult } from "../../main/enginever.js"
import { bridge } from "../use-async.js"
import { Blank, Field } from "./SettingsBits.js"
import { CopyIcon } from "./icons.js"

/**
 * 这台机器上**没有这一家**的时候，这一行说什么。
 *
 * ## 为什么值得单独做一件事
 *
 * 上一版这种情况整行从设置页消失，只留一句「没探到这家的安装版本；
 * 它可能尚未安装，或不在当前 PATH 中」。那句话没有错，但它**说不出下一步**——
 * 而这个仓库自己的规矩正是「报错必须说得出下一步该干什么」
 *（`docs/工程时间线.md` 里那条：界面上一律毫无反应的不是「还没做的功能」，
 * 是把故障吞掉了）。
 *
 * ## 命令是抄来的，不是编的
 *
 * 只有 omni 真的知道来源的那几家才给命令（npm 上那两家、加上轻量版 Claude），
 * 其余照实说「omni 不知道这一家怎么装」并指个方向。
 * **编一条看起来像模像样的命令是这里最坏的选项**：它一旦是错的，
 * 用户会以为是 omni 把机器装坏了，而 omni 根本没有能力维护那条命令。
 *
 * 命令**永远先摆出来再执行**：那颗按钮逐字跑的就是上面那行字，
 * 不点也可以自己复制去终端跑。
 */
export function EngineInstall({
  version,
  busy,
  onCopy,
  onBusy,
  onDone,
}: {
  version: EngineVersion
  busy: boolean
  onCopy: (text: string) => void
  onBusy: (engine: string | undefined) => void
  onDone: (next: EngineVersion) => void
}): React.JSX.Element {
  const omni = bridge()
  const [result, setResult] = useState<UpdateResult | undefined>(undefined)
  const [running, setRunning] = useState(false)
  const command = version.install
  return (
    <>
      <Field label={version.label} hint={hintOf(version, running, result)} stack={command !== undefined}>
        {command === undefined ? (
          <span className="set__hint">omni 不代装这一家</span>
        ) : (
          <div className="eng-command">
            <code>{command}</code>
            <button
              type="button"
              className="tbtn"
              onClick={() => {
                onCopy(command)
              }}
            >
              <CopyIcon /> 复制命令
            </button>
            <button
              type="button"
              className="tbtn"
              disabled={busy}
              aria-busy={running}
              title={`将执行：${command}`}
              onClick={() => {
                const request = omni?.installEngine(version.engine)
                if (request === undefined) return
                setRunning(true)
                onBusy(version.engine)
                setResult(undefined)
                void request
                  .then((next) => {
                    setResult(next)
                    if (next.ok && next.after !== undefined) {
                      onDone({ ...version, installed: next.after, missing: false })
                    }
                  })
                  .catch((error: unknown) => {
                    setResult({ ok: false, changed: false, output: messageOf(error) })
                  })
                  .finally(() => {
                    setRunning(false)
                    onBusy(undefined)
                  })
              }}
            >
              {running ? "安装中…" : "安装"}
            </button>
          </div>
        )}
      </Field>
      {result !== undefined && !result.ok ? (
        <pre className="set__log" role="alert">
          {result.output.slice(-1200)}
        </pre>
      ) : null}
      {result?.ok === true ? <Blank>装好了：{result.after ?? "已就绪"}。</Blank> : null}
    </>
  )
}

function hintOf(
  version: EngineVersion,
  running: boolean,
  result: UpdateResult | undefined,
): string {
  if (running) return "正在装，别关窗口…"
  if (result !== undefined && !result.ok) return "没装成；下面是原文"
  const where = version.detail ?? "这一家在这台机器上不在 PATH 上"
  return version.install === undefined
    ? `还没装。${where}`
    : `还没装。点「安装」会逐字执行右边那条命令，${where === version.detail ? where : "装完 omni 会自己重新探测"}`
}

function messageOf(error: unknown): string {
  return `安装请求失败：${error instanceof Error ? error.message : String(error)}`
}
