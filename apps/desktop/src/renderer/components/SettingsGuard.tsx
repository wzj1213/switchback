import { useEffect, useState } from "react"
import type { Settings } from "../../shared/settings.js"
import type { EgressRecord, GuardReport, ZcodeStatus } from "../../shared/guard.js"
import { Blank, Field, Group, Toggle } from "./SettingsBits.js"
import { RevealIcon } from "./icons.js"
import { useMessages } from "../i18n.js"
import { SETTINGS_GUARD } from "./SettingsGuard.messages.js"

/** 开着这一页时多久重读一次账：数字在动，人才信它是活的。 */
const POLL_MS = 5000


function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`
  const mb = bytes / (1024 * 1024)
  return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`
}

function useGuard(): GuardReport | undefined {
  const [report, setReport] = useState<GuardReport>()
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.switchback
    if (bridge === undefined) return undefined
    const state = { live: true }
    const read = (): void => {
      void bridge.guard().then((next) => {
        if (state.live) setReport(next)
      }, () => undefined)
    }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => {
      state.live = false
      clearInterval(timer)
    }
  }, [])
  return report
}

/** 一个引擎进程这次启动以来的账：一行。 */
function RecordRow({ record }: { record: EgressRecord }): React.JSX.Element {
  const m = useMessages(SETTINGS_GUARD)
  const tool = record.toolSent > 0 ? m.toolSent(size(record.toolSent)) : ""
  return (
    <Field
      label={record.label}
      tag={`pid ${String(record.leader)}`}
      hint={m.record(size(record.sent), size(record.received), tool, size(record.peak))}
    >
      {null}
    </Field>
  )
}

function Records({ records }: { records: readonly EgressRecord[] | undefined }): React.JSX.Element {
  const m = useMessages(SETTINGS_GUARD)
  if (records === undefined) return <Blank>{m.reading}</Blank>
  if (records.length === 0) return <Blank>{m.noRecords}</Blank>
  return <>{records.map((record) => <RecordRow key={record.key} record={record} />)}</>
}

function ZcodeGroup({ zcode, lock, onLock, onReveal }: {
  zcode: ZcodeStatus
  lock: boolean
  onLock: (on: boolean) => void
  onReveal: (path: string) => void
}): React.JSX.Element {
  const m = useMessages(SETTINGS_GUARD)
  const { checkpoints } = zcode
  const version = zcode.version === undefined ? "" : ` ${zcode.version}`
  const hint = zcode.app === undefined
    ? m.installedBefore
    : zcode.affected
      ? m.affected(version)
      : m.fixed(version)
  const lockHint = checkpoints.locked ? m.locked : lock ? m.locking : m.unlocked
  return (
    <Group title="ZCode" hint={hint} more={m.zcodeNote}>
      <Field label={m.lockLabel} hint={lockHint}>
        <Toggle label={m.lockToggle} on={lock} onChange={onLock} />
      </Field>
      {checkpoints.archives === 0 ? null : (
        <Field
          label={m.pendingLabel}
          hint={m.pendingHint(checkpoints.archives, size(checkpoints.bytes))}
        >
          <button type="button" className="iconbtn" aria-label={m.revealSnapshots} data-tip={m.reveal} onClick={() => { onReveal(checkpoints.path) }}>
            <RevealIcon />
          </button>
        </Field>
      )}
    </Group>
  )
}

/**
 * 「外发守卫」：每个引擎往本机外面发了多少，批量外发时停不停；装着 ZCode 时它的防护状态。
 * 放在「数据与排查」最上面：这是「我的代码有没有被传出去」的那一页。
 */
export function GuardSection({ settings, onPatch, onReveal }: {
  settings: Settings
  onPatch: (patch: Partial<Settings>) => void
  onReveal: (path: string) => void
}): React.JSX.Element {
  const report = useGuard()
  const m = useMessages(SETTINGS_GUARD)
  const zcode = report?.zcode
  return (
    <>
      <Group title={m.title} hint={m.hint} more={m.guardNote}>
        <Field label={m.stop} hint={m.stopHint}>
          <Toggle label={m.stop} on={settings.egressStop} onChange={(egressStop) => { onPatch({ egressStop }) }} />
        </Field>
        <Records records={report?.records} />
      </Group>
      {zcode === undefined || (zcode.app === undefined && !zcode.checkpoints.exists) ? null : (
        <ZcodeGroup zcode={zcode} lock={settings.zcodeLock} onLock={(zcodeLock) => { onPatch({ zcodeLock }) }} onReveal={onReveal} />
      )}
    </>
  )
}
