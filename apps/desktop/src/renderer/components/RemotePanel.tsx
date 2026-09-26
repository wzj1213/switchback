import { useCallback, useEffect, useState } from "react"
import type { RemoteStatus } from "../../main/remote/install.js"
import type { Settings } from "../../shared/settings.js"
import { Field, Group, Input, Toggle } from "./SettingsBits.js"
import { Access, Tunnel } from "./RemoteAccess.js"

/**
 * 远程访问（浏览器端）。
 *
 * ## 这一节要说清楚的三件事
 *
 * 1. **它默认关着**，开关在这里。
 * 2. **开了也只 listen 回环**——从外面进来要自己开隧道。界面上必须写出来，
 *    否则用户会以为打开开关就能在手机上打开它，然后在一个连不上的地址前发呆。
 * 3. **配对码只出现一次，五分钟**。
 *
 * ## 为什么这一页要重画
 *
 * 它是整块面板里**唯一一页不套 `Group`** 的：几行设置项直接裸挂在页面上，
 * 没有卡片、没有分组标题，于是它和别的页长得就是不一样，而没有任何东西会报错。
 * 那颗开关还是一颗写着「打开」的按钮——**按钮上的字是动作还是状态，两种读法都说得通**。
 * 端口更彻底：`settings.remote.port` 一直存在、一直被校验、一直在决定服务端听哪儿，
 * 而界面上**根本没有地方能改它**。
 */

function statusText(status: RemoteStatus): string {
  // **配置有问题和起不来是两回事。** 之前这里一律说「起不来」——
  // 而最常见的那种（域名那栏填错）恰恰是**服务端好好地在听**，
  // 只是每个从隧道进来的请求都被闸门拦掉。写「起不来」会把人支到
  // 完全错误的方向上去查（端口？防火墙？），而真正要改的是下面那一栏
  if (status.error !== undefined) {
    return status.listening ? `在听，但配置有问题：${status.error}` : `起不来：${status.error}`
  }
  if (!status.enabled) return "关着。打开之后它只听回环，不会凭空暴露到网上"
  return status.listening ? `在听 127.0.0.1:${String(status.port)}` : "开着，但没在听"
}

/** 端口那一栏。**空着或者填了个不是数字的东西时不写回去**——那会把服务端挪到 0 号口上。 */
function PortField({ port, onPort }: { port: number; onPort: (port: number) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(String(port))
  const bad = parsePort(draft) === undefined
  return (
    <Field
      label="端口"
      hint={
        bad
          ? "要一个 0–65535 的整数。改完这一栏服务端会重起一次，正连着的设备要刷新一下。"
          : "回环上的端口。0 = 让系统挑一个空的。改完服务端会重起一次，隧道命令里的号也要跟着改。"
      }
    >
      <Input
        label="远程端口"
        value={draft}
        inputMode="numeric"
        placeholder="17800"
        onChange={(next) => {
          setDraft(next)
          const parsed = parsePort(next)
          if (parsed !== undefined) onPort(parsed)
        }}
      />
    </Field>
  )
}

function parsePort(raw: string): number | undefined {
  const n = Number(raw.trim())
  return raw.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : undefined
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
      {/* 组名不再写「远程访问」：页标题就是这四个字，紧跟着再写一遍是同一句话念两次 */}
      <Group
        title="服务"
        hint="在手机或另一台电脑的浏览器里接着用同一批会话。服务端跑在这台机器上，默认整个关着。"
      >
        <Field label="开启" hint={status === undefined ? "正在读…" : statusText(status)}>
          <Toggle
            label="远程访问"
            on={settings.remote.enabled}
            onChange={(enabled) => {
              patchRemote({ enabled })
            }}
          />
        </Field>
        {!settings.remote.enabled ? null : (
          <PortField
            port={settings.remote.port}
            onPort={(port) => {
              patchRemote({ port })
            }}
          />
        )}
      </Group>
      {!settings.remote.enabled ? null : (
        <>
          <Tunnel remote={settings.remote} onPatch={patchRemote} />
          <Access remote={settings.remote} status={status} onPatch={patchRemote} onStatus={setStatus} />
        </>
      )}
    </>
  )
}
