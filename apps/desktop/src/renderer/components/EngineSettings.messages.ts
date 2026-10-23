import { defineMessages } from "@switchback/i18n"

/** 设置 → 引擎：每家一页的外框。 */
export const ENGINE_SETTINGS = defineMessages(
  {
    none: "还没有可配置的引擎。",
    label: "引擎配置",
    modelTitle: "新会话的模型与思考档",
    modelHint: "平时会记住这家上一次开工时的选择；这里可以直接改，也可以退回引擎默认。",
    carry: "沿用配置",
    carryEmpty: "先用这家开过会话，才会列出它自己报告的模型",
    carryHint: "只影响之后新开的会话，当前会话不会被重启。选项是这家引擎本次实际报告的清单",
    installNote: "装一家、升级到新版、或者接一家 Switchback 还不认识的 ACP 引擎——都在「安装与接入」。",
    go: "去那儿",
    pick: "选择引擎",
    tab: (label: string, state: string, pinned: boolean) => `${label}，${state}${pinned ? "，新会话默认" : ""}`,
    pinned: "默认",
  },
  {
    none: "No engines to configure yet.",
    label: "Engine settings",
    modelTitle: "Model and reasoning level for new threads",
    modelHint: "Normally the choice from this engine's last run is remembered. You can change it here or fall back to the engine default.",
    carry: "Carry over",
    carryEmpty: "Open a thread with this engine first to list the models it reports",
    carryHint: "Only affects threads opened from now on; open threads aren't restarted. The options are what this engine actually reported this time",
    installNote: "Installing or upgrading an engine, or connecting an ACP engine Switchback doesn't know yet, all happens under Install & connect.",
    go: "Go there",
    pick: "Choose an engine",
    tab: (label, state, pinned) => `${label}, ${state}${pinned ? ", default for new threads" : ""}`,
    pinned: "Default",
  },
)
