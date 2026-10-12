import type { Trust } from "@switchback/protocol"
import type { RemoteStatus } from "../../main/remote/install.js"
import { Select } from "./Select.js"
import { Field } from "./SettingsBits.js"

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
function since(at: number, now: number): string {
  const secs = Math.max(0, Math.round((now - at) / 1000))
  if (secs < 60) return "刚刚"
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${String(mins)} 分钟前`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${String(hours)} 小时前`
  return `${String(Math.round(hours / 24))} 天前`
}

const TRUST_LABELS: Readonly<Record<Trust, string>> = {
  "read-only": "只读",
  "auto-edit": "自动审批",
  full: "完全访问",
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
  return (
    <Select
      label={own === undefined ? `跟随默认（${TRUST_LABELS[fallback]}）` : TRUST_LABELS[own]}
      name="这台的上限"
      sections={[
        {
          value: own ?? FOLLOW,
          choices: [
            { id: FOLLOW, label: `跟随默认（${TRUST_LABELS[fallback]}）` },
            ...(Object.keys(TRUST_LABELS) as Trust[]).map((id) => ({ id, label: TRUST_LABELS[id] })),
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
  if (devices.length === 0) {
    return <Field label="已配对的设备" hint="还没有。点上面那颗「配对新设备」" children={null} />
  }
  const now = Date.now()
  return (
    <Field label="已配对的设备" hint="丢了设备就在这里吊销它——它正连着的那条连接会当场断开">
      <ul className="devices">
        {devices.map((device) => (
          <li key={device.id} className="devices__row">
            <span className="devices__name">{device.name}</span>
            {/* 老记录没有种类字段：那时配的全是手机端 */}
            <span className="devices__kind">{device.kind === "desk" ? "电脑" : "手机"}</span>
            <DeviceTrust device={device} fallback={fallback} onTrust={onTrust} />
            <span className="devices__seen">{since(device.lastSeenAt, now)}</span>
            <button
              type="button"
              className="tbtn tbtn--danger"
              onClick={() => {
                onRevoke(device.id)
              }}
            >
              吊销
            </button>
          </li>
        ))}
      </ul>
    </Field>
  )
}
