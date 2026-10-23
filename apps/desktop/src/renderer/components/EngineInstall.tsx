import { useState } from "react"
import type { EngineVersion, UpdateResult } from "../../main/enginever.js"
import { bridge } from "../use-async.js"
import { Blank, Field } from "./SettingsBits.js"
import { CopyIcon } from "./icons.js"
import type { Locale } from "@switchback/i18n"
import { useMessages } from "../i18n.js"
import { ENGINE_INSTALL } from "./EngineInstall.messages.js"

type Text = (typeof ENGINE_INSTALL)[Locale]

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
 * 只有 Switchback 真的知道来源的那几家才给命令（npm 上那两家、加上轻量版 Claude），
 * 其余照实说「Switchback 不知道这一家怎么装」并指个方向。
 * **编一条看起来像模像样的命令是这里最坏的选项**：它一旦是错的，
 * 用户会以为是 Switchback 把机器装坏了，而 Switchback 根本没有能力维护那条命令。
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
  const switchback = bridge()
  const m = useMessages(ENGINE_INSTALL)
  const [result, setResult] = useState<UpdateResult | undefined>(undefined)
  const [running, setRunning] = useState(false)
  const command = version.install
  return (
    <>
      <Field label={version.label} hint={hintOf(version, running, result, m)} stack={command !== undefined}>
        {command === undefined ? (
          <span className="set__hint">{m.noInstall}</span>
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
              <CopyIcon /> {m.copy}
            </button>
            <button
              type="button"
              className="tbtn"
              disabled={busy}
              aria-busy={running}
              title={m.willRun(command)}
              onClick={() => {
                const request = switchback?.installEngine(version.engine)
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
                    setResult({ ok: false, changed: false, output: messageOf(error, m) })
                  })
                  .finally(() => {
                    setRunning(false)
                    onBusy(undefined)
                  })
              }}
            >
              {running ? m.installing : m.install}
            </button>
          </div>
        )}
      </Field>
      {result !== undefined && !result.ok ? (
        <pre className="set__log" role="alert">
          {result.output.slice(-1200)}
        </pre>
      ) : null}
      {result?.ok === true ? <Blank>{m.done(result.after ?? m.ready)}</Blank> : null}
    </>
  )
}

function hintOf(
  version: EngineVersion,
  running: boolean,
  result: UpdateResult | undefined,
  m: Text,
): string {
  if (running) return m.running
  if (result !== undefined && !result.ok) return m.failed
  const where = version.detail ?? m.notOnPath
  return version.install === undefined
    ? m.notInstalled(where)
    : m.clickInstall(where === version.detail ? where : m.redetect)
}

function messageOf(error: unknown, m: Text): string {
  return m.requestFailed(error instanceof Error ? error.message : String(error))
}
