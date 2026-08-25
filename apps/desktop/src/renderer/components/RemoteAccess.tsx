import { useEffect, useState } from "react"
import type { Trust } from "@omni/protocol"
import type { RemoteStatus } from "../../main/remote/install.js"
import type { Settings } from "../../shared/settings.js"
import { Field, Group, Input, Segmented } from "./SettingsBits.js"
import { RemoteDevices } from "./RemoteDevices.js"

/**
 * 远程那一页开着之后才出现的两组：**怎么从外面连进来**、**谁能进来**。
 *
 * 从 `RemotePanel` 拆出来是行数闸门逼的，但边界也对：那边管「开不开、听哪个口」，
 * 这边管「开了之后的事」——它们只在 `enabled` 为真时才存在。
 */

const TRUSTS = [
  { id: "read-only", label: "只读" },
  { id: "auto-edit", label: "自动审批" },
  { id: "full", label: "完全访问" },
] as const

/** 配对码那一块。**只有真的在配对时才画**——没有码的时候摆一个空框没有意义。 */
function Pairing({ status, onPair }: { status: RemoteStatus; onPair: () => void }): React.JSX.Element {
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
      <button type="button" className="tbtn" onClick={onPair} disabled={!status.listening}>
        配对新设备…
      </button>
    )
  }
  return (
    <div className="pairing">
      <code className="pairing__code">{status.pairing.code}</code>
      <span className="pairing__left">{left} 秒后失效</span>
    </div>
  )
}

/** 「怎么从外面连」——**这一段全是说明**，只有域名那一栏是要填的。 */
export function Tunnel({ remote, onPatch }: {
  remote: Settings["remote"]
  onPatch: (next: Partial<Settings["remote"]>) => void
}): React.JSX.Element {
  return (
    <Group
      title="从外面怎么连"
      hint="服务端只听回环，没有绑到公网的开关——一个能改成 0.0.0.0 的选项，迟早会有人在公网机器上打开它，而那台机器上跑着一个有写和执行权限的 agent。"
    >
      <Field label="先开一条反向隧道" hint="在这台机器上跑这一条，把端口映到你自己的服务器上" stack>
        <code className="set__code">
          ssh -R 127.0.0.1:{remote.port}:127.0.0.1:{remote.port} 你的服务器
        </code>
      </Field>
      <Field
        label="隧道那头的域名"
        hint="留空 = 只认回环。把手机上要打开的地址粘进来就行（https:// 会自动去掉）；带路径的会报错"
        stack
      >
        <Input
          label="隧道那头的域名"
          value={remote.trustedHosts.join(" ")}
          placeholder="omni.example.com:8443"
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
  const omni = typeof window === "undefined" ? undefined : window.omni
  return (
    <Group title="谁能进来" hint="手机丢了不该等于在你的仓库里任意执行代码。">
      <Field
        label="远程档位上限"
        hint="默认「自动审批」：远程能改文件，但每条 shell 命令仍然要弹审批——也就是你在手机上看得见每一条要跑的命令"
        stack
      >
        <Segmented
          options={TRUSTS}
          value={remote.maxTrust}
          onPick={(maxTrust) => {
            onPatch({ maxTrust: maxTrust as Trust })
          }}
        />
      </Field>
      <Field label="配对" hint="在手机上打开那个地址，把码输进去。五分钟有效，用一次作废">
        {status === undefined ? null : (
          <Pairing
            status={status}
            onPair={() => {
              void omni?.remote.pair().then(onStatus)
            }}
          />
        )}
      </Field>
      <RemoteDevices
        devices={status?.devices ?? []}
        onRevoke={(id) => {
          void omni?.remote.revoke(id).then(onStatus)
        }}
      />
    </Group>
  )
}
