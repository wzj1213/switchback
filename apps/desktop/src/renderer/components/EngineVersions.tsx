import { useMemo, useState } from "react"
import type { EngineVersion, UpdateResult } from "../../main/enginever.js"
import { bridge, useAsync } from "../use-async.js"
import { Actions, Blank, Field } from "./SettingsBits.js"
import { EngineInstall } from "./EngineInstall.js"
import { rescanMessage } from "../rescan-message.js"

/**
 * 安装与版本——**所有引擎一次列全**。
 *
 * ## 为什么不再挂在每一家下面
 *
 * 上一版这块长在每家引擎的 tab 里（`EngineNative` 的「版本与更新」组），
 * 于是同一件事有五个入口：想看 codex 的版本要先点 codex，看 claude 要再点 claude。
 * 而**数据本来就是全量的**——`engineVersions()` 一次返回整个数组，
 * 每个 tab 只是从里面 `find` 出自己那条。连「重新检查」都有五颗，点哪颗都一样：
 * 全都是同一次全量请求。
 *
 * 那不是「统一的安装入口」，那是同一个入口印了五份。摊平成一张表之后，
 * 「这台机器上装了哪几家、哪几家该升级」变成扫一眼的事，
 * 而各家 tab 里只剩真正属于那一家的东西。
 *
 * ## 表里没有的那些
 *
 * 只列 omni **确实知道版本来源**的那几家。第三方 ACP 引擎的版本与安装由它自己管，
 * omni 编不出那条命令——这一点写在组说明里，不在表里摆一行「未知」占位。
 *
 * 主进程缓存探测结果六小时；「重新检查」走的是**同一条通道的 `again` 分支**，
 * 由 `useAsync` 传下去——以前这里自己再发一次强制请求，于是两条请求赛跑，
 * 赢的那条往往是拿着缓存的那条。
 */
export function EngineVersions({
  onCopy,
}: {
  onCopy: (text: string) => void
}): React.JSX.Element {
  const omni = bridge()
  const load = useMemo(
    () => (omni === undefined ? undefined : (again: boolean) => omni.engineVersions(again)),
    [omni],
  )
  const state = useAsync<readonly EngineVersion[]>(load)
  const [updating, setUpdating] = useState<string | undefined>(undefined)
  const [rescanning, setRescanning] = useState(false)
  // 上一次重新探测的结果。**大多数时候它是「没有变化」**——而那句话
  // 恰恰是这颗按钮最该说的：「我查过了」和「我没查」必须分得出来
  const [rescanned, setRescanned] = useState<string | undefined>(undefined)
  // 装完 / 更新完就地覆盖那一行，不用为了看到新版本号再等一次全量探测。
  // 按 engine 存：这是一张表了，一个单值会让 A 的结果盖到 B 的行上
  const [patched, setPatched] = useState<Readonly<Record<string, EngineVersion>>>({})
  const list = (state.data ?? []).map((version) => patched[version.engine] ?? version)
  const busy = state.loading || updating !== undefined || rescanning
  const patch = (next: EngineVersion): void => {
    setPatched((prev) => ({ ...prev, [next.engine]: next }))
  }

  return (
    <>
      <Probe loading={state.data === undefined && !state.failed} failed={state.failed} />
      {list.map((version) =>
        version.missing === true ? (
          <EngineInstall
            key={`install-${version.engine}`}
            version={version}
            busy={busy}
            onCopy={onCopy}
            onBusy={setUpdating}
            onDone={patch}
          />
        ) : (
          <EngineRow
            key={version.engine}
            version={version}
            active={updating}
            checking={state.loading}
            onActive={setUpdating}
            onDone={patch}
          />
        ),
      )}
      <Actions>
        <button
          type="button"
          className="tbtn"
          disabled={busy}
          title="重新看这台机器上装了哪几家（本地跑一遍 which 与 --version）"
          onClick={() => {
            setRescanning(true)
            setRescanned(undefined)
            setPatched({})
            void (omni?.rescanEngines() ?? Promise.resolve([]))
              .then((changed) => {
                setRescanned(rescanMessage(changed))
              })
              .catch(() => {
                setRescanned("探测没跑起来；日志里有原文。")
              })
              .finally(() => {
                setRescanning(false)
                state.reload()
              })
          }}
        >
          {rescanning ? "正在探…" : "重新探测"}
        </button>
        <button
          type="button"
          className="tbtn"
          disabled={busy}
          title="无视缓存，重新询问 npm 与各家原生更新器有没有新版"
          onClick={() => {
            setPatched({})
            state.reload()
          }}
        >
          {state.loading ? "正在查…" : "检查新版"}
        </button>
        {/* 结果紧挨着那颗按钮，不另起一块：它是那一下的回执，不是一条独立通知 */}
        {rescanned === undefined ? null : (
          <span className="set__hint" role="status">
            {rescanned}
          </span>
        )}
      </Actions>
    </>
  )
}

/**
 * 读取那两种状态。**收成一个出口**：两句话分开写的下场这个仓库见过——
 * 同一块面板里几句「正在读…」字号和内边距各不相同，而它们在用户眼里是同一件事。
 *
 * 上一版还有第三个分支「omni 没有这一家的版本来源」——那是**按家看**时才存在的
 * 状态。摊平成一张表之后没有来源的那几家压根不在表里，那句话搬进了组说明。
 */
function Probe({ loading, failed }: { loading: boolean; failed: boolean }): React.JSX.Element | null {
  if (loading) return <Blank>正在检查安装版本…</Blank>
  if (failed) return <Blank tone="error">版本探测失败；点上面那颗可以再试一次。</Blank>
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
