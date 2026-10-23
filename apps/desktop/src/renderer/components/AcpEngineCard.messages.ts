import { defineMessages } from "@switchback/i18n"

/** 已接入的一家 ACP 引擎。 */
export const ACP_ENGINE_CARD = defineMessages(
  {
    manual: "手动接入",
    registry: (version: string, kind: string) => `注册表 · v${version} · ${kind}`,
    inUseTip: "改动要等这些会话关掉才换上",
    inUse: "有会话在用",
    tryTip: "发一次 ACP 的 initialize，只握手不开会话；登录方式会一起列出来",
    trying: "试接中…",
    try: "试接",
    newer: (version: string) => `注册表里有新版 v${version}。`,
    upgrade: "升级",
    remove: "移除",
    removeInUse: "有会话在用它：先从 engines.json 摘掉，那些会话关掉后才真正卸下",
    removeTip: "从 engines.json 删掉这一条；下载过的二进制一并清掉",
    removeFailed: "没删成。",
    removePending: "已从 engines.json 摘掉；正在用它的会话关掉之后才真正卸下。",
    confirm: "确定移除？",
  },
  {
    manual: "Added manually",
    registry: (version, kind) => `Registry · v${version} · ${kind}`,
    inUseTip: "Changes take over once these threads close",
    inUse: "In use",
    tryTip: "Sends one ACP initialize: only a handshake, no thread. Sign-in methods are listed with it",
    trying: "Trying…",
    try: "Try",
    newer: (version) => `The registry has a new version, v${version}. `,
    upgrade: "Upgrade",
    remove: "Remove",
    removeInUse: "A thread is using it: it's taken out of engines.json now and fully removed once those threads close",
    removeTip: "Delete this entry from engines.json, along with any downloaded binary",
    removeFailed: "Couldn't remove it.",
    removePending: "Removed from engines.json; it's fully unloaded once the threads using it close.",
    confirm: "Remove?",
  },
)
