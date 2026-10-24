import { defineMessages } from "@switchback/i18n"

/** 设置页每一家引擎的状态牌与那句提示。探测给了原话（`detail`）就用原话，这里只是回落。 */
export const ENGINE_STATE = defineMessages(
  {
    off: "已关掉",
    offHint: "你在这儿关掉了它：不探测、不出现在引擎选择器里。它自己的命令行照常能用。",
    ok: "可用",
    okHint: "宿主已探测到这家引擎。",
    missing: "未安装",
    missingHint: "当前 PATH 中没有探测到它。",
    broken: "起不来",
    brokenHint: "探到了，但它启动不了。",
    unknown: "未确认",
    waiting: "等待探测",
    unsureHint: "探测没有给出明确结论；Switchback 不会据此声称它不可用。",
    dshOff: "未接入",
    dshOffHint: "确认原生配置后才探测，也不会提前启动 DSH。",
    dshProbing: (profile: string) => `正在探测 \`${profile}\` profile。`,
  },
  {
    off: "Turned off",
    offHint: "You turned it off here: it isn't detected and doesn't appear in the engine picker. Its own command line still works.",
    ok: "Available",
    okHint: "The host detected this engine.",
    missing: "Not installed",
    missingHint: "It wasn't found on the current PATH.",
    broken: "Won't start",
    brokenHint: "It was found, but it won't start.",
    unknown: "Unconfirmed",
    waiting: "Detecting",
    unsureHint: "Detection gave no clear answer, so Switchback won't claim it's unavailable.",
    dshOff: "Not connected",
    dshOffHint: "It's only detected after you confirm its native setup, and DSH isn't started before then.",
    dshProbing: (profile) => `Detecting the \`${profile}\` profile.`,
  },
)
