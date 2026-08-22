import { useEffect, useState } from "react"
import type { EngineVersion, UpdateResult } from "../../main/enginever.js"
import { Field } from "./SettingsBits.js"

/**
 * 各家引擎的版本与人工更新入口。主进程缓存探测结果六小时；这里还负责保证
 * 同一时间只跑一个全局安装，并让失败的 Promise 一定退出 loading 状态。
 */
export function EngineVersions({ engine }: { engine: string }): React.JSX.Element {
  const [list, setList] = useState<readonly EngineVersion[] | undefined>(undefined)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState<string | undefined>(undefined)
  const [checkError, setCheckError] = useState<string | undefined>(undefined)
  const bridge = typeof window === "undefined" ? undefined : window.omni

  useEffect(() => {
    let live = true
    const request = bridge?.engineVersions()
    void request
      ?.then((versions) => {
        if (live) setList(versions)
      })
      .catch((error: unknown) => {
        if (!live) return
        setList([])
        setCheckError(`版本探测失败：${messageOf(error)}`)
      })
    return () => {
      live = false
    }
  }, [bridge])

  const selected = list?.find((version) => version.engine === engine)

  return (
    <>
      {list === undefined ? <p className="set__blank">正在检查安装版本…</p> : null}
      {list !== undefined && selected === undefined ? (
        <p className="set__blank">没探到这家的安装版本；它可能尚未安装，或不在当前 PATH 中。</p>
      ) : null}
      {checkError === undefined ? null : (
        <p className="set__blank set__blank--error" role="alert">
          {checkError}
        </p>
      )}
      {selected === undefined ? null : (
        <EngineRow
          key={selected.engine}
          version={selected}
          active={updating}
          checking={checking}
          onActive={setUpdating}
          onDone={(next) => {
            setList((previous) =>
              (previous ?? []).map((item) => (item.engine === next.engine ? next : item)),
            )
          }}
        />
      )}
      <div className="set__act">
        <button
          type="button"
          className="tbtn"
          disabled={checking || updating !== undefined}
          title="无视缓存，重新询问 npm 与各家原生更新器"
          onClick={() => {
            const request = bridge?.engineVersions(true)
            if (request === undefined) return
            setChecking(true)
            setCheckError(undefined)
            void request
              .then(setList)
              .catch((error: unknown) => setCheckError(`重新检查失败：${messageOf(error)}`))
              .finally(() => setChecking(false))
          }}
        >
          {checking ? "正在查…" : "重新检查"}
        </button>
      </div>
    </>
  )
}

interface EngineRowProps {
  version: EngineVersion
  active: string | undefined
  checking: boolean
  onActive: (engine: string | undefined) => void
  onDone: (next: EngineVersion) => void
}

function EngineRow({
  version,
  active,
  checking,
  onActive,
  onDone,
}: EngineRowProps): React.JSX.Element {
  const [result, setResult] = useState<UpdateResult | undefined>(undefined)
  const bridge = typeof window === "undefined" ? undefined : window.omni
  const running = active === version.engine
  const actionable = version.update !== undefined && (version.stale || version.latest === undefined)

  return (
    <>
      <Field label={version.label} hint={hintOf(version, running, result)}>
        {actionable ? (
          <button
            type="button"
            className="tbtn"
            disabled={checking || active !== undefined}
            aria-busy={running}
            title={`将执行：${version.update ?? ""}`}
            onClick={() => {
              const request = bridge?.updateEngine(version.engine)
              if (request === undefined) return
              onActive(version.engine)
              setResult(undefined)
              void request
                .then((next) => {
                  setResult(next)
                  if (next.ok)
                    onDone({ ...version, installed: next.after ?? version.installed, stale: false })
                })
                .catch((error: unknown) => setResult(failedResult(error)))
                .finally(() => onActive(undefined))
            }}
          >
            {running ? "更新中…" : actionOf(version)}
          </button>
        ) : (
          <span className="set__hint">—</span>
        )}
      </Field>
      {result !== undefined && (!result.ok || !result.changed) ? (
        <pre className="set__log" {...(result.ok ? {} : { role: "alert" })}>
          {result.output.slice(-1200)}
        </pre>
      ) : null}
    </>
  )
}

function actionOf(version: EngineVersion): string {
  return version.stale ? `更新到 ${version.latest ?? "最新"}` : "检查并更新"
}

function hintOf(
  version: EngineVersion,
  running: boolean,
  result: UpdateResult | undefined,
): string {
  if (result !== undefined) return resultHint(version, result)
  if (running) return "正在更新，别关窗口…"
  if (version.stale) return `装的是 ${shown(version.installed)}，最新 ${shown(version.latest)}`
  if (version.detail !== undefined) return detailHint(version)
  return `${shown(version.installed)}（已是最新）`
}

function resultHint(version: EngineVersion, result: UpdateResult): string {
  const after = shown(result.after === undefined ? version.installed : result.after)
  if (!result.ok) return `没更新成（还是 ${after}）`
  if (result.changed) return `已更新到 ${after}`
  return `更新器已检查（仍是 ${after}）`
}

function detailHint(version: EngineVersion): string {
  if (version.installed === undefined) return shown(version.detail)
  return `${version.installed} · ${shown(version.detail)}`
}

function shown(value: string | undefined): string {
  return value === undefined ? "?" : value
}

function failedResult(error: unknown): UpdateResult {
  return { ok: false, changed: false, output: `更新请求失败：${messageOf(error)}` }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
