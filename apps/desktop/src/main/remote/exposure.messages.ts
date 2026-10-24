import { defineMessages } from "@switchback/i18n"

/** 远程窗口不能做某件事时的理由。`keys` 是拒的时候人能看懂的设置名；没列到的键照原样说。 */
export const REMOTE_EXPOSURE = defineMessages(
  {
    keys: {
      theme: "主题（它改的是那台机器上的窗口；这边的明暗跟着这台电脑的系统走）",
      remote: "远程访问",
      egressStop: "外发守卫",
      zcodeLock: "ZCode 快照锁",
      disabledEngines: "停用的引擎",
      defaultTrust: "默认档位",
      dsh: "DSH",
      notify: "通知",
      handoffBrief: "换引擎自动交接",
    },
    notObject: "设置的写入要一个对象",
    hostOnly: (names: readonly string[]) => `「${names.join("、")}」只能在那台机器上改，远程只能改界面偏好`,
    phone: "这台设备是按手机配对的，只能看住与放行；要完整界面，在那台机器上按「电脑」重新配对",
    hostOnlyCall: (method: string) => `这一项只能在那台机器上做（${method}）`,
    readOnly: "这台设备的远程上限是只读，改不了那台机器上的文件",
  },
  {
    keys: {
      theme: "Theme (it changes the windows on the host machine; light or dark here follows this computer's system)",
      remote: "Remote access",
      egressStop: "Egress guard",
      zcodeLock: "ZCode snapshot lock",
      disabledEngines: "Disabled engines",
      defaultTrust: "Default tier",
      dsh: "DSH",
      notify: "Notifications",
      handoffBrief: "Automatic handoff on engine switch",
    },
    notObject: "A settings write needs an object",
    hostOnly: (names) => `“${names.join("”, “")}” can only be changed on the host machine. Remotely you can only change interface preferences`,
    phone: "This device was paired as a phone, so it can only watch and approve. For the full interface, pair it again with “Pair a computer” on the host machine",
    hostOnlyCall: (method) => `This can only be done on the host machine (${method})`,
    readOnly: "This device's remote limit is read-only, so it can't change files on the host machine",
  },
)
