import { defineMessages } from "@switchback/i18n"

/** 手机的配对页。配对之前问不到宿主说哪种话，用的是上次记下的语言。 */
export const PAIR = defineMessages(
  {
    expired: "这台设备的授权已经不在了（被吊销，或者 Switchback 换了机器）。重新配一次。",
    fresh: "在桌面上打开「设置 → 远程访问」，点「配对手机」，把那八位码输进来。",
    code: "配对码",
    name: "这台设备叫什么",
    unreachable: "连不上 Switchback",
    pairing: "正在配对…",
    pair: "配对",
    browser: (os: string | undefined) => (os === undefined ? "浏览器" : `${os} 上的浏览器`),
    note: "配好之后，这台设备能做的事有上限——具体到哪一档，在桌面上的「设置 → 远程访问」里定。丢了设备就在那里吊销它。",
  },
  {
    expired: "This device's authorization is gone (revoked, or Switchback moved to another machine). Pair it again.",
    fresh: "On the desktop, open Settings → Remote access, click “Pair a phone”, and enter the eight-character code here.",
    code: "Pairing code",
    name: "Name for this device",
    unreachable: "Can't reach Switchback",
    pairing: "Pairing…",
    pair: "Pair",
    browser: (os) => (os === undefined ? "Browser" : `Browser on ${os}`),
    note: "Once paired, what this device can do has a limit, set on the desktop under Settings → Remote access. If you lose the device, revoke it there.",
  },
)
