import { useEffect, useState } from "react"
import type { Trust } from "@switchback/protocol"
import type { RemoteStatus } from "../../main/remote/install.js"
import type { Settings } from "../../shared/settings.js"
import { Field, Group, Input, Segmented } from "./SettingsBits.js"
import { RemoteDevices } from "./RemoteDevices.js"
import { trustsOf } from "../trusts.js"
import { useLocale, useMessages } from "../i18n.js"
import { REMOTE_ACCESS } from "./RemoteAccess.messages.js"

/**
 * 远程那一页开着之后才出现的两组：**怎么从外面连进来**、**谁能进来**。
 *
 * 从 `RemotePanel` 拆出来是行数闸门逼的，但边界也对：那边管「开不开、听哪个口」，
 * 这边管「开了之后的事」——它们只在 `enabled` 为真时才存在。
 */

/**
 * 配对码那一块。**只有真的在配对时才画**——没有码的时候摆一个空框没有意义。
 *
 * 开码时就选这台算手机还是电脑（`docs/远程模式方案.md` §2.3）：**种类跟着码走**，
 * 设备自己报的不作数——否则一部手机说一句「我是电脑」就多拿到一整个面。
 */
function Pairing({ status, onPair }: { status: RemoteStatus; onPair: (kind: "phone" | "desk") => void }): React.JSX.Element {
  const m = useMessages(REMOTE_ACCESS)
  const [left, setLeft] = useState(0)
  const expiresAt = status.pairing?.expiresAt
  useEffect(() => {
    if (expiresAt === undefined) return undefined
    const tick = (): void => {
      setLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)))
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [expiresAt])

  if (status.pairing === undefined || left === 0) {
    return (
      <div className="pairing">
        <button type="button" className="tbtn" onClick={() => { onPair("phone") }} disabled={!status.listening}>
          {m.pairPhone}
        </button>
        <button type="button" className="tbtn" onClick={() => { onPair("desk") }} disabled={!status.listening}>
          {m.pairDesk}
        </button>
      </div>
    )
  }
  return (
    <div className="pairing">
      <code className="pairing__code">{status.pairing.code}</code>
      <span className="pairing__left">
        {status.pairing.kind === "desk" ? m.kindDesk : m.kindPhone}
        {m.expires(left)}
      </span>
    </div>
  )
}

/** 「怎么从外面连」——**这一段全是说明**，只有域名那一栏是要填的。 */
export function Tunnel({ remote, onPatch }: {
  remote: Settings["remote"]
  onPatch: (next: Partial<Settings["remote"]>) => void
}): React.JSX.Element {
  const m = useMessages(REMOTE_ACCESS)
  return (
    <Group
      title={m.tunnel}
      hint={m.tunnelHint}
    >
      <Field label={m.reverse} hint={m.reverseHint} stack>
        <code className="set__code">
          ssh -R 127.0.0.1:{remote.port}:127.0.0.1:{remote.port} {m.server}
        </code>
      </Field>
      <Field
        label={m.host}
        hint={m.hostHint}
        stack
      >
        <Input
          label={m.host}
          value={remote.trustedHosts.join(" ")}
          placeholder="switchback.example.com:8443"
          onChange={(value) => {
            onPatch({ trustedHosts: value.split(/\s+/u).filter((s) => s !== "") })
          }}
        />
      </Field>
    </Group>
  )
}

/** 「谁能进来」——档位上限、配对、已配对的设备。**吊销要一眼找得到**。 */
export function Access({ remote, status, onPatch, onStatus }: {
  remote: Settings["remote"]
  status: RemoteStatus | undefined
  onPatch: (next: Partial<Settings["remote"]>) => void
  onStatus: (status: RemoteStatus) => void
}): React.JSX.Element {
  const switchback = typeof window === "undefined" ? undefined : window.switchback
  const locale = useLocale()
  const m = REMOTE_ACCESS[locale]
  return (
    <Group title={m.access} hint={m.accessHint}>
      <Field
        label={m.maxTrust}
        hint={m.maxTrustHint}
        stack
      >
        <Segmented
          options={trustsOf(locale).map((t) => ({ id: t.id, label: t.label }))}
          value={remote.maxTrust}
          onPick={(maxTrust) => {
            onPatch({ maxTrust: maxTrust as Trust })
          }}
        />
      </Field>
      <Field
        label={m.pair}
        hint={m.pairHint}
      >
        {status === undefined ? null : (
          <Pairing
            status={status}
            onPair={(kind) => {
              void switchback?.remote.pair(kind).then(onStatus)
            }}
          />
        )}
      </Field>
      <RemoteDevices
        devices={status?.devices ?? []}
        fallback={remote.maxTrust}
        onTrust={(id, trust) => {
          void switchback?.remote.setDeviceTrust(id, trust).then(onStatus)
        }}
        onRevoke={(id) => {
          void switchback?.remote.revoke(id).then(onStatus)
        }}
      />
    </Group>
  )
}
