import { useEffect, useState } from "react"
import type { Settings } from "../../shared/settings.js"
import type { EgressRecord, GuardReport, ZcodeStatus } from "../../shared/guard.js"
import { Blank, Field, Group, Toggle } from "./SettingsBits.js"
import { RevealIcon } from "./icons.js"

/** 开着这一页时多久重读一次账：数字在动，人才信它是活的。 */
const POLL_MS = 5000

const GUARD_NOTE =
  "看的是系统自己记的账（macOS 的 nettop，只算离开这台机器的流量，本机回环不算），" +
  "判的是引擎自己一分钟发了多少：模型对话一次请求通常几十到几百 KB，一百万 token 的上下文也就四 MB 上下；" +
  "而整个仓库连同 .git 往外打包是几百 MB。它当着你的面跑的命令（git push、npm publish）照样记账，但不拿来判——那是你让它做的事。" +
  "omni 只看、只停，不改引擎的配置、不挡它的请求。"

const ZCODE_NOTE =
  "2026-09 有人逆向出来：ZCode 登录着就在后台把整个工作区（完整 .git 历史、LFS 缓存、reflog）打包加密，" +
  "传到阿里云 OSS；设置里的开关管不住它。3.14.0 删掉了这条链路。待传的包先落在它的快照目录里，" +
  "给这个目录加上不可改标志，它就写不进新包。已经在里面的包是你的代码（加密的，钥匙在对方手里），omni 不删，要不要删你来定。"

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`
  const mb = bytes / (1024 * 1024)
  return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`
}

function useGuard(): GuardReport | undefined {
  const [report, setReport] = useState<GuardReport>()
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.omni
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
  const tool = record.toolSent > 0 ? ` · 它跑的命令发出 ${size(record.toolSent)}` : ""
  return (
    <Field
      label={record.label}
      tag={`pid ${String(record.leader)}`}
      hint={`自己发出 ${size(record.sent)} · 收到 ${size(record.received)}${tool} · 最多的一分钟 ${size(record.peak)}`}
    >
      {null}
    </Field>
  )
}

function Records({ records }: { records: readonly EgressRecord[] | undefined }): React.JSX.Element {
  if (records === undefined) return <Blank>正在读…</Blank>
  if (records.length === 0) return <Blank>这次启动以来还没有引擎在跑。开一条会话，这里就会记下它往外发了多少。</Blank>
  return <>{records.map((record) => <RecordRow key={record.key} record={record} />)}</>
}

function ZcodeGroup({ zcode, lock, onLock, onReveal }: {
  zcode: ZcodeStatus
  lock: boolean
  onLock: (on: boolean) => void
  onReveal: (path: string) => void
}): React.JSX.Element {
  const { checkpoints } = zcode
  const version = zcode.version === undefined ? "" : ` ${zcode.version}`
  const hint = zcode.app === undefined
    ? "这台机器上装过 ZCode（它的数据目录还在）。"
    : zcode.affected
      ? `本机装着 ZCode${version}：这一版会在后台把整个工作区连同 .git 历史打包上传（3.14.0 修掉）。建议升级或卸载。`
      : `本机装着 ZCode${version}，已经是修好之后的版本。`
  const lockHint = checkpoints.locked
    ? "已上锁：它写不进新的包，上传链路就断了。修好的版本用不到这个目录，锁着也不碍事"
    : lock ? "正在上锁…" : "没上锁：旧版本照样能把工作区打包进这个目录再传出去"
  return (
    <Group title="ZCode" hint={hint} more={ZCODE_NOTE}>
      <Field label="给它的快照目录上锁" hint={lockHint}>
        <Toggle label="给 ZCode 的快照目录上锁" on={lock} onChange={onLock} />
      </Field>
      {checkpoints.archives === 0 ? null : (
        <Field
          label="还没传出去的包"
          hint={`${String(checkpoints.archives)} 个，共 ${size(checkpoints.bytes)}。里面是你的代码，omni 不删它们`}
        >
          <button type="button" className="iconbtn" aria-label="在访达中显示快照目录" data-tip="在访达中显示" onClick={() => { onReveal(checkpoints.path) }}>
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
  const zcode = report?.zcode
  return (
    <>
      <Group title="外发守卫" hint="omni 一直看着每个引擎进程往本机外面发了多少——不只是它说了什么。" more={GUARD_NOTE}>
        <Field label="批量外发时停掉" hint="引擎自己一分钟内往外发了超过 64 MB（不算它跑的命令）就停掉它，并告诉你它当时连着谁。关掉就只提醒">
          <Toggle label="批量外发时停掉" on={settings.egressStop} onChange={(egressStop) => { onPatch({ egressStop }) }} />
        </Field>
        <Records records={report?.records} />
      </Group>
      {zcode === undefined || (zcode.app === undefined && !zcode.checkpoints.exists) ? null : (
        <ZcodeGroup zcode={zcode} lock={settings.zcodeLock} onLock={(zcodeLock) => { onPatch({ zcodeLock }) }} onReveal={onReveal} />
      )}
    </>
  )
}
