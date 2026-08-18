import { useCallback, useEffect, useState } from "react"
import type { Trust } from "@omni/protocol"
import type { RemoteStatus } from "../../main/remote/install.js"
import type { Settings } from "../../shared/settings.js"
import { Field } from "./SettingsBits.js"
import { RemoteDevices } from "./RemoteDevices.js"

/**
 * 远程访问（浏览器端）。
 *
 * ## 这一节要说清楚的三件事
 *
 * 1. **它默认关着**，开关在这里。
 * 2. **开了也只 listen 回环**——从外面进来要自己开隧道。界面上必须写出来，
 *    否则用户会以为打开开关就能在手机上打开它，然后在一个连不上的地址前发呆。
 * 3. **配对码只出现一次，五分钟**。
 */

const TRUSTS: readonly { id: Trust; label: string }[] = [
  { id: "read-only", label: "只读" },
  { id: "auto-edit", label: "自动编辑" },
  { id: "full", label: "完全" },
]

function statusText(status: RemoteStatus): string {
  if (status.error !== undefined) return `起不来：${status.error}`
  if (!status.enabled) return "关着"
  return status.listening ? `在听 127.0.0.1:${String(status.port)}` : "开着，但没在听"
}

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

export function RemotePanel({
  settings,
  onPatch,
}: {
  settings: Settings
  onPatch: (next: Partial<Settings>) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<RemoteStatus | undefined>(undefined)
  const bridge = typeof window === "undefined" ? undefined : window.omni

  useEffect(() => {
    if (bridge === undefined) return undefined
    void bridge.remote.status().then(setStatus)
    // 配对码在倒计时、设备的「最后见到」在变——每两秒问一次够了。
    // **不做推送**：这一节只在设置面板开着时可见，而那是分钟级的事
    const timer = setInterval(() => {
      void bridge.remote.status().then(setStatus)
    }, 2000)
    return () => {
      clearInterval(timer)
    }
  }, [bridge])

  /** 改 `settings.remote` 之后**必须 sync**，否则改了不生效。 */
  const patchRemote = useCallback(
    (next: Partial<Settings["remote"]>) => {
      onPatch({ remote: { ...settings.remote, ...next } })
      void bridge?.remote.sync().then(setStatus)
    },
    [bridge, onPatch, settings.remote],
  )

  return (
    <>
      <Field label="远程访问" hint={status === undefined ? "正在读…" : statusText(status)}>
        <button
          type="button"
          className={`tbtn${settings.remote.enabled ? " tbtn--on" : ""}`}
          onClick={() => {
            patchRemote({ enabled: !settings.remote.enabled })
          }}
        >
          {settings.remote.enabled ? "关掉" : "打开"}
        </button>
      </Field>

      {!settings.remote.enabled ? null : (
        <>
          <Field
            label="怎么从外面连"
            hint="服务端只听回环，没有绑到公网的开关。要从手机上用，在这台机器上开一条反向隧道，再把隧道那头的域名填进下面那一栏。"
          >
            <code className="set__code">ssh -R 127.0.0.1:{settings.remote.port}:127.0.0.1:{settings.remote.port} 你的服务器</code>
          </Field>
          <Field label="隧道那头的域名" hint="留空 = 只认回环。写成裸 host[:port]；带路径或 scheme 会在启动时报错">
            <input
              className="set__input"
              value={settings.remote.trustedHosts.join(" ")}
              placeholder="omni.example.com:8443"
              onChange={(e) => {
                patchRemote({ trustedHosts: e.target.value.split(/\s+/).filter((s) => s !== "") })
              }}
            />
          </Field>
          <Field label="远程档位上限" hint="手机丢了不该等于在你的仓库里任意执行代码。默认「自动编辑」：能改文件，但每条命令仍要你点一次">
            <div className="switch" role="radiogroup">
              {TRUSTS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={settings.remote.maxTrust === t.id}
                  className={`switch__item${settings.remote.maxTrust === t.id ? " switch__item--on" : ""}`}
                  onClick={() => {
                    patchRemote({ maxTrust: t.id })
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="配对" hint="在手机上打开那个地址，把码输进去。五分钟有效，用一次作废">
            {status === undefined ? null : (
              <Pairing
                status={status}
                onPair={() => {
                  void bridge?.remote.pair().then(setStatus)
                }}
              />
            )}
          </Field>
          <RemoteDevices
            devices={status?.devices ?? []}
            onRevoke={(id) => {
              void bridge?.remote.revoke(id).then(setStatus)
            }}
          />
        </>
      )}
    </>
  )
}
