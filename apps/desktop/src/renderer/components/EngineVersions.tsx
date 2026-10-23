import { useMemo, useState } from "react"
import type { EngineVersion, UpdateResult } from "../../main/enginever.js"
import { bridge, useAsync } from "../use-async.js"
import { Actions, Blank, Field } from "./SettingsBits.js"
import { EngineInstall } from "./EngineInstall.js"
import { rescanMessage } from "../rescan-message.js"
import type { Locale } from "@switchback/i18n"
import { useLocale, useMessages } from "../i18n.js"
import { ENGINE_VERSIONS } from "./EngineVersions.messages.js"

type Text = (typeof ENGINE_VERSIONS)[Locale]

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
 * 只列 Switchback **确实知道版本来源**的那几家。第三方 ACP 引擎的版本与安装由它自己管，
 * Switchback 编不出那条命令——这一点写在组说明里，不在表里摆一行「未知」占位。
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
  const switchback = bridge()
  const load = useMemo(
    () => (switchback === undefined ? undefined : (again: boolean) => switchback.engineVersions(again)),
    [switchback],
  )
  const state = useAsync<readonly EngineVersion[]>(load)
  const locale = useLocale()
  const m = ENGINE_VERSIONS[locale]
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
          title={m.rescanTip}
          onClick={() => {
            setRescanning(true)
            setRescanned(undefined)
            setPatched({})
            void (switchback?.rescanEngines() ?? Promise.resolve({ changed: [], needsRestart: [] }))
              .then((done) => {
                setRescanned(rescanMessage(done.changed, done.needsRestart, locale))
              })
              .catch(() => {
                setRescanned(m.rescanFailed)
              })
              .finally(() => {
                setRescanning(false)
                state.reload()
              })
          }}
        >
          {rescanning ? m.rescanning : m.rescan}
        </button>
        <button
          type="button"
          className="tbtn"
          disabled={busy}
          title={m.checkTip}
          onClick={() => {
            setPatched({})
            state.reload()
          }}
        >
          {state.loading ? m.checking : m.check}
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
 * 上一版还有第三个分支「Switchback 没有这一家的版本来源」——那是**按家看**时才存在的
 * 状态。摊平成一张表之后没有来源的那几家压根不在表里，那句话搬进了组说明。
 */
function Probe({ loading, failed }: { loading: boolean; failed: boolean }): React.JSX.Element | null {
  const m = useMessages(ENGINE_VERSIONS)
  if (loading) return <Blank>{m.probing}</Blank>
  if (failed) return <Blank tone="error">{m.probeFailed}</Blank>
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
  const switchback = bridge()
  const m = useMessages(ENGINE_VERSIONS)
  const running = active === version.engine
  const actionable = version.update !== undefined && (version.stale || version.latest === undefined)

  return (
    <>
      <Field label={version.label} hint={hintOf(version, running, result, m)}>
        {actionable ? (
          <button
            type="button"
            className="tbtn"
            disabled={checking || active !== undefined}
            aria-busy={running}
            title={m.willRun(version.update ?? "")}
            onClick={() => {
              const request = switchback?.updateEngine(version.engine)
              if (request === undefined) return
              onActive(version.engine)
              setResult(undefined)
              void request
                .then((next) => {
                  setResult(next)
                  if (next.ok)
                    onDone({ ...version, installed: next.after ?? version.installed, stale: false })
                })
                .catch((error: unknown) => setResult(failedResult(error, m)))
                .finally(() => onActive(undefined))
            }}
          >
            {running ? m.updating : actionOf(version, m)}
          </button>
        ) : null}
      </Field>
      {result !== undefined && (!result.ok || !result.changed) ? (
        <pre className="set__log" {...(result.ok ? {} : { role: "alert" })}>
          {result.output.slice(-1200)}
        </pre>
      ) : null}
    </>
  )
}

function actionOf(version: EngineVersion, m: Text): string {
  return version.stale ? m.updateTo(version.latest ?? m.latest) : m.checkUpdate
}

function hintOf(
  version: EngineVersion,
  running: boolean,
  result: UpdateResult | undefined,
  m: Text,
): string {
  if (result !== undefined) return resultHint(version, result, m)
  if (running) return m.runningHint
  if (version.stale) return m.stale(shown(version.installed), shown(version.latest))
  if (version.detail !== undefined) return detailHint(version)
  return m.upToDate(shown(version.installed))
}

function resultHint(version: EngineVersion, result: UpdateResult, m: Text): string {
  const after = shown(result.after === undefined ? version.installed : result.after)
  if (!result.ok) return m.notUpdated(after)
  if (result.changed) return m.updated(after)
  return m.unchanged(after)
}

function detailHint(version: EngineVersion): string {
  if (version.installed === undefined) return shown(version.detail)
  return `${version.installed} · ${shown(version.detail)}`
}

function shown(value: string | undefined): string {
  return value === undefined ? "?" : value
}

function failedResult(error: unknown, m: Text): UpdateResult {
  return { ok: false, changed: false, output: m.requestFailed(messageOf(error)) }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
