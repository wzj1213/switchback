import { defineMessages } from "@switchback/i18n"

/** 分叉、从这里重来、换引擎时宿主自己说的话。引擎名原样显示。 */
export const BRANCH = defineMessages(
  {
    rewindLabel: "重来",
    busy: "当前轮次尚未结束，不能分叉或从历史轮次重来",
    noTurn: (turnId: string) => `找不到要重来的历史轮次：${turnId}`,
    noContext: (engine: string) => `${engine} 当前不能带着原生上下文从这一轮重来`,
    notNative: (engine: string) =>
      `这一轮之前都是别家跑的，${engine} 自己的原生会话里没有它们，没法带着上下文从这里重来。` +
      "换回原来那家再从这里重来，或者从这一家自己跑的轮次重来。",
    notAttached: "新引擎启动后会话没有接入",
    switchBusy: "当前轮次尚未结束，不能立即切换引擎",
  },
  {
    rewindLabel: "restart",
    busy: "The current turn hasn't finished, so you can't fork or restart from an earlier turn",
    noTurn: (turnId) => `Can't find the earlier turn to restart from: ${turnId}`,
    noContext: (engine) => `${engine} can't restart from this turn with its native context right now`,
    notNative: (engine) =>
      `Every turn before this one was run by other engines, so ${engine}'s own native session doesn't have them and can't restart from here with context. ` +
      `Switch back to the engine that ran them and restart from here, or restart from a turn ${engine} ran itself.`,
    notAttached: "The thread didn't attach after the new engine started",
    switchBusy: "The current turn hasn't finished, so the engine can't be switched right now",
  },
)
