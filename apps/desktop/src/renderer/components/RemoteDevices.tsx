import type { RemoteStatus } from "../../main/remote/install.js"
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

export function RemoteDevices({
  devices,
  onRevoke,
}: {
  devices: RemoteStatus["devices"]
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
