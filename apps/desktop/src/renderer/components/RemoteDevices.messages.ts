import { defineMessages } from "@switchback/i18n"

/** 已配对的设备。设备名是它自己报的，不翻译。 */
export const REMOTE_DEVICES = defineMessages(
  {
    justNow: "刚刚",
    minutesAgo: (n: number) => `${String(n)} 分钟前`,
    hoursAgo: (n: number) => `${String(n)} 小时前`,
    daysAgo: (n: number) => `${String(n)} 天前`,
    follow: (label: string) => `跟随默认（${label}）`,
    limit: "这台的上限",
    devices: "已配对的设备",
    none: "还没有。点上面的「配对手机」或「配对电脑」",
    devicesHint: "丢了设备就在这里吊销它——它正连着的那条连接会当场断开",
    desk: "电脑",
    phone: "手机",
    revoke: "吊销",
  },
  {
    justNow: "just now",
    minutesAgo: (n) => `${String(n)}m ago`,
    hoursAgo: (n) => `${String(n)}h ago`,
    daysAgo: (n) => `${String(n)}d ago`,
    follow: (label) => `Follow default (${label})`,
    limit: "This device's limit",
    devices: "Paired devices",
    none: "None yet. Click “Pair a phone” or “Pair a computer” above",
    devicesHint: "If you lose a device, revoke it here; its current connection drops immediately",
    desk: "Computer",
    phone: "Phone",
    revoke: "Revoke",
  },
)
