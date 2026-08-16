import { useEffect, useState } from "react"
import type { EngineVersion, UpdateResult } from "../../main/enginever.js"
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
export function EngineVersions(): React.JSX.Element {
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
        <EngineRow
          key={v.engine}
          v={v}
          onDone={(next) => {
            setList((prev) => prev.map((x) => (x.engine === next.engine ? next : x)))
          }}
        />
      ))}
    </>
  )
}

/**
 * 一家引擎一行：装的哪版、要不要更新、更新中、更新完了。
 *
 * ## 命令是摆出来的，不是藏起来的
 *
 * 按钮的 `title` 就是**将要逐字执行的那条命令**。「更新」两个字背后
 * 藏一条你没看过的命令，是这类按钮最不该有的样子——尤其它动的是全局环境。
 *
 * ## 结果用重新探测得出，不用 npm 说的
 *
 * npm 说装成功了不等于 `codex --version` 就变了（装到别的前缀、
 * PATH 里还有另一个旧的）。**只信重新探到的那个数。**
 */
function EngineRow({ v, onDone }: { v: EngineVersion; onDone: (next: EngineVersion) => void }): React.JSX.Element {
  const [state, setState] = useState<"idle" | "running">("idle")
  const [result, setResult] = useState<UpdateResult | undefined>(undefined)
  const bridge = typeof window === "undefined" ? undefined : window.omni

  const hint = hintOf(v, state, result)

  return (
    <>
      <Field label={v.engine} hint={hint}>
        {v.stale && result === undefined ? (
          <button
            type="button"
            className="tbtn"
            disabled={state === "running"}
            // **把将要执行的命令原样摆出来**
            title={`将执行：${v.update ?? ""}`}
            onClick={() => {
              setState("running")
              void bridge?.updateEngine(v.engine).then((r) => {
                setState("idle")
                setResult(r)
                if (r.ok) onDone({ ...v, installed: r.after ?? v.installed, stale: false })
              })
            }}
          >
            {state === "running" ? "更新中…" : `更新到 ${v.latest ?? "最新"}`}
          </button>
        ) : (
          <span className="set__hint">—</span>
        )}
      </Field>
      {/* 失败时把 npm 的原文摊出来。「更新失败」四个字排查不了任何东西 */}
      {result !== undefined && !result.ok ? <pre className="set__log">{result.output.slice(-1200)}</pre> : null}
    </>
  )
}

/** 那一行右边说什么。抽出来纯粹是分支太多撞了复杂度闸门。 */
function hintOf(v: EngineVersion, state: "idle" | "running", result: UpdateResult | undefined): string {
  if (result !== undefined) {
    return result.ok ? `已更新到 ${result.after ?? "?"}` : `没更新成（还是 ${result.after ?? v.installed ?? "?"}）`
  }
  if (state === "running") return "正在更新，别关窗口…"
  if (v.stale) return `装的是 ${v.installed ?? "?"}，最新 ${v.latest ?? "?"}`
  return `${v.installed ?? "?"}（已是最新）`
}
