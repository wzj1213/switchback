import { useMemo, useState } from "react"
import type { EngineVersion, UpdateResult } from "../../main/enginever.js"
import { bridge, useAsync } from "../use-async.js"
import { Actions, Blank, Field } from "./SettingsBits.js"
import { EngineInstall } from "./EngineInstall.js"

/**
 * 各家引擎的版本与人工更新入口。
 *
 * 主进程缓存探测结果六小时；「重新检查」走的是**同一条通道的 `again` 分支**，
 * 由 `useAsync` 传下去——以前这里自己再发一次强制请求，于是两条请求赛跑，
 * 赢的那条往往是拿着缓存的那条。
 */
export function EngineVersions({
  engine,
  onCopy,
}: {
  engine: string
  onCopy: (text: string) => void
}): React.JSX.Element {
  const omni = bridge()
  const load = useMemo(
    () => (omni === undefined ? undefined : (again: boolean) => omni.engineVersions(again)),
    [omni],
  )
  const state = useAsync<readonly EngineVersion[]>(load)
  const [updating, setUpdating] = useState<string | undefined>(undefined)
  const [patched, setPatched] = useState<EngineVersion | undefined>(undefined)
  const found = state.data?.find((version) => version.engine === engine)
  // 更新成功之后本地覆盖一份，不用为了看到新版本号再探一次
  const selected = patched?.engine === engine ? patched : found

  const busy = state.loading || updating !== undefined
  return (
    <>
      <Probe loading={state.data === undefined && !state.failed} failed={state.failed} unknown={state.data !== undefined && selected === undefined} />
      {selected?.missing === true ? (
        <EngineInstall
          key={`install-${selected.engine}`}
          version={selected}
          busy={busy}
          onCopy={onCopy}
          onBusy={setUpdating}
          onDone={setPatched}
        />
      ) : null}
      {selected === undefined || selected.missing === true ? null : (
        <EngineRow
          key={selected.engine}
          version={selected}
          active={updating}
          checking={state.loading}
          onActive={setUpdating}
          onDone={setPatched}
        />
      )}
      <Actions>
        <button
          type="button"
          className="tbtn"
          disabled={busy}
          title="无视缓存，重新询问 npm 与各家原生更新器"
          onClick={() => {
            setPatched(undefined)
            state.reload()
          }}
        >
          {state.loading ? "正在查…" : "重新检查"}
        </button>
      </Actions>
    </>
  )
}

/**
 * 探测那三种状态。**收成一个出口**：三句话分开写的下场这个仓库见过——
 * 同一块面板里三句「正在读…」字号和内边距各不相同，而它们在用户眼里是同一件事。
 */
function Probe({
  loading,
  failed,
  unknown,
}: {
  loading: boolean
  failed: boolean
  unknown: boolean
}): React.JSX.Element | null {
  if (loading) return <Blank>正在检查安装版本…</Blank>
  if (failed) return <Blank tone="error">版本探测失败；点下面那颗可以再试一次。</Blank>
  if (unknown) return <Blank>omni 没有这一家的版本来源——第三方 ACP 引擎的版本与安装由它自己管。</Blank>
  return null
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
  const omni = bridge()
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
              const request = omni?.updateEngine(version.engine)
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
