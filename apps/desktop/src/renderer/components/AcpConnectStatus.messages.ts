import { defineMessages } from "@switchback/i18n"

/** 接入 / 升级一家注册表引擎的确认与结果。失败原因是原文，不翻译。 */
export const ACP_STATUS = defineMessages(
  {
    verb: { connect: "接入", upgrade: "升级" },
    cancel: "取消",
    failed: (verb: string) => `${verb}失败。`,
    retry: "再试一次",
    close: "收起",
    upgraded: (version: string) => `已升级到 v${version}。`,
    connected: (name: string) => `已接入，现在就能在引擎下拉里选「${name}」。`,
    pending: "有会话正在用旧版本，它们关掉之后才换上新的。",
    cantRun: "这台机器上起不了它。",
    license: (license: string) => `许可 ${license}`,
    join: (items: readonly string[]) => items.join("、"),
    will: (what: string) => `将${what}`,
    confirmNote: (note: string) => `${note}接之前先握手试接，答不上来就不写进 engines.json。`,
    facts: (facts: readonly string[]) => `（${facts.join(" · ")}）`,
    confirm: (verb: string) => `确认${verb}`,
  },
  {
    verb: { connect: "Connect", upgrade: "Upgrade" },
    cancel: "Cancel",
    failed: (verb) => `${verb} failed.`,
    retry: "Try again",
    close: "Close",
    upgraded: (version) => `Upgraded to v${version}. `,
    connected: (name) => `Connected. You can now pick “${name}” in the engine menu. `,
    pending: "Some threads are using the old version; the new one takes over once they close.",
    cantRun: "It can't run on this Mac.",
    license: (license) => `License ${license}`,
    join: (items) => items.join(", "),
    will: (what) => `Will ${what}`,
    confirmNote: (note) => `${note} Before connecting, it tries a handshake; if that fails, nothing is written to engines.json.`,
    facts: (facts) => ` (${facts.join(" · ")})`,
    confirm: (verb) => verb,
  },
)
