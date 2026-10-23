import type { Trust } from "@switchback/protocol"
import type { RemoteStatus } from "../../main/remote/install.js"
import { Select } from "./Select.js"
import { Field } from "./SettingsBits.js"
import type { Locale } from "@switchback/i18n"
import { trustsOf } from "../trusts.js"
import { useLocale, useMessages } from "../i18n.js"
import { REMOTE_DEVICES } from "./RemoteDevices.messages.js"

type Text = (typeof REMOTE_DEVICES)[Locale]

/**
 * 已配对的设备。
 *
 * **吊销要摆在能一眼找到的地方**：需要用到它的时刻是「手机丢了」，
 * 而那时人不会有耐心翻菜单。所以每一行右边直接是那颗按钮，没有二级菜单。
 *
 * 它**当场断开那台设备正连着的连接**，不只是删掉记录——只删记录的话，
 * 一台没断线的设备永远等不到「下一次连接」，于是它继续收全部事件、
 * 继续能替你放行 agent 要跑的每一条命令。见 `remote/server.ts` 的 `disconnect`。
 *
 * 不做二次确认：吊销是**可逆的**（重新配一次就回来了），而多一次确认
 * 会在真正紧急的那一刻多挡一下。
 */

/** 「最后见到」的人话说法。**不显示绝对时间戳**——那要人自己去减。 */
function since(at: number, now: number, m: Text): string {
  const secs = Math.max(0, Math.round((now - at) / 1000))
  if (secs < 60) return m.justNow
  const mins = Math.round(secs / 60)
  if (mins < 60) return m.minutesAgo(mins)
  const hours = Math.round(mins / 60)
  if (hours < 24) return m.hoursAgo(hours)
  return m.daysAgo(Math.round(hours / 24))
}

/** 「跟随默认」那一项的 id。`Select` 的选项 id 是字符串，「没有自己的上限」得有个名字。 */
const FOLLOW = "follow"

/**
 * 一台设备自己的上限。缺省跟着上面那条默认走；**跟随时也写出现在是哪一档**——
 * 只写「跟随默认」的话，人要回头去找那条默认才知道这台到底能干什么。
 */
function DeviceTrust({ device, fallback, onTrust }: {
  device: RemoteStatus["devices"][number]
  fallback: Trust
  onTrust: (id: string, trust?: Trust) => void
}): React.JSX.Element {
  const own = device.maxTrust
  const locale = useLocale()
  const m = REMOTE_DEVICES[locale]
  const trusts = trustsOf(locale)
  const labelOf = (id: Trust): string => trusts.find((t) => t.id === id)?.label ?? id
  return (
    <Select
      label={own === undefined ? m.follow(labelOf(fallback)) : labelOf(own)}
      name={m.limit}
      sections={[
        {
          value: own ?? FOLLOW,
          choices: [
            { id: FOLLOW, label: m.follow(labelOf(fallback)) },
            ...trusts.map((t) => ({ id: t.id, label: t.label })),
          ],
          onPick: (id) => {
            onTrust(device.id, id === FOLLOW ? undefined : (id as Trust))
          },
        },
      ]}
    />
  )
}

export function RemoteDevices({
  devices,
  fallback,
  onTrust,
  onRevoke,
}: {
  devices: RemoteStatus["devices"]
  /** 设备没有自己的上限时跟的那条（`settings.remote.maxTrust`）。 */
  fallback: Trust
  onTrust: (id: string, trust?: Trust) => void
  onRevoke: (id: string) => void
}): React.JSX.Element {
  const m = useMessages(REMOTE_DEVICES)
  if (devices.length === 0) {
    return <Field label={m.devices} hint={m.none} children={null} />
  }
  const now = Date.now()
  return (
    <Field label={m.devices} hint={m.devicesHint}>
      <ul className="devices">
        {devices.map((device) => (
          <li key={device.id} className="devices__row">
            <span className="devices__name">{device.name}</span>
            {/* 老记录没有种类字段：那时配的全是手机端 */}
            <span className="devices__kind">{device.kind === "desk" ? m.desk : m.phone}</span>
            <DeviceTrust device={device} fallback={fallback} onTrust={onTrust} />
            <span className="devices__seen">{since(device.lastSeenAt, now, m)}</span>
            <button
              type="button"
              className="tbtn tbtn--danger"
              onClick={() => {
                onRevoke(device.id)
              }}
            >
              {m.revoke}
            </button>
          </li>
        ))}
      </ul>
    </Field>
  )
}
