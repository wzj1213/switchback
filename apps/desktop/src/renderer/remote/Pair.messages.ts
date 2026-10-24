import { defineMessages } from "@switchback/i18n"

/** 远程窗口的配对页。 */
export const REMOTE_PAIR = defineMessages(
  {
    hint: {
      fresh: "在那台机器上打开 Switchback →「设置 → 远程访问」，点「配对电脑」，把那八位码输进来。",
      expired: "这台电脑的授权已经不在了（被吊销，或者那台换了机器）。重新配一次。",
      phone: "这台浏览器拿的是手机端的授权，只能看住与放行。要完整界面，在那台机器上点「配对电脑」重新配一次。",
    },
    code: "配对码",
    name: "这台电脑叫什么",
    unreachable: "连不上那台机器",
    pairing: "正在配对…",
    pair: "配对",
    browser: (os: string | undefined) => (os === undefined ? "浏览器" : `${os} 上的浏览器`),
  },
  {
    hint: {
      fresh: "On the host machine, open Switchback → Settings → Remote access, click “Pair a computer”, and enter the eight-character code here.",
      expired: "This computer's authorization is gone (revoked, or the host machine changed). Pair it again.",
      phone: "This browser has a phone authorization, which can only watch and approve. For the full interface, click “Pair a computer” on the host machine and pair again.",
    },
    code: "Pairing code",
    name: "Name for this computer",
    unreachable: "Can't reach the host machine",
    pairing: "Pairing…",
    pair: "Pair",
    browser: (os) => (os === undefined ? "Browser" : `Browser on ${os}`),
  },
)
