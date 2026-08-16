import { useEffect, useState } from "react"
import type { EngineVersion } from "../../main/enginever.js"
import { Field } from "./SettingsPanel.js"

/**
 * 各家引擎装的是哪版、有没有新版。
 *
 * ## 为什么不自动更新
 *
 * 更新引擎是往**用户全局环境**里写东西（`npm i -g` 会动 `/opt/homebrew/lib`），
 * 而且新版可能带 breaking change、可能要求重新登录。**这类事得他自己点头。**
 *
 * 所以做到「主动检测 + 把命令给他 + 一键复制」为止。
 * 少按一次键换来的是「某天早上打开发现引擎自己换了版本、而且不认之前的登录」，
 * 那不是省事，是把一个他能控制的问题变成不能控制的。
 */
export function EngineVersions({ onCopy }: { onCopy: (text: string) => void }): React.JSX.Element {
  const [list, setList] = useState<readonly EngineVersion[]>([])
  const bridge = typeof window === "undefined" ? undefined : window.omni

  useEffect(() => {
    let live = true
    void bridge?.engineVersions().then((v) => {
      if (live) setList(v)
    })
    return () => {
      live = false
    }
  }, [bridge])

  if (list.length === 0) return <p className="set__hint">正在看各家引擎的版本…</p>
  return (
    <>
      {list.map((v) => (
        <Field
          key={v.engine}
          label={v.engine}
          hint={v.stale ? `装的是 ${v.installed ?? "?"}，最新 ${v.latest ?? "?"}` : `${v.installed ?? "?"}（已是最新）`}
        >
          {v.stale && v.update !== undefined ? (
            <button
              type="button"
              className="tbtn"
              title={`复制这条命令，到终端里跑：${v.update}`}
              onClick={() => {
                onCopy(v.update ?? "")
              }}
            >
              复制更新命令
            </button>
          ) : (
            <span className="set__hint">—</span>
          )}
        </Field>
      ))}
    </>
  )
}
