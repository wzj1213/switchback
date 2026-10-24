import { defineMessages } from "@switchback/i18n"

/** 实时连接（WebSocket）上出的错。Kimi 自己给的拒绝理由（`msg`）优先，原样透传。 */
export const KIMI_STREAM = defineMessages(
  {
    noRuntime: "当前 Node 运行时没有 WebSocket，请使用 Node 22 或更新版本",
    badFrame: "Kimi WebSocket 发来了无法识别的数据帧",
    resync: "Kimi WebSocket 要求重新同步",
    refused: "Kimi WebSocket 拒绝订阅这个会话",
    handshake: "Kimi WebSocket 在订阅握手阶段没有响应",
    failed: "Kimi WebSocket 连接失败",
    offsetResync: "Kimi 流式 offset 要求重新同步",
    closedEarly: "Kimi WebSocket 在订阅完成前断开",
    reconnectFailed: "Kimi WebSocket 重连失败",
  },
  {
    noRuntime: "This Node runtime has no WebSocket. Use Node 22 or later",
    badFrame: "The Kimi WebSocket sent a frame Switchback couldn't read",
    resync: "The Kimi WebSocket asked for a resync",
    refused: "The Kimi WebSocket refused to subscribe to this thread",
    handshake: "The Kimi WebSocket didn't respond during the subscribe handshake",
    failed: "Couldn't connect to the Kimi WebSocket",
    offsetResync: "The Kimi stream offset requires a resync",
    closedEarly: "The Kimi WebSocket closed before the subscription finished",
    reconnectFailed: "Couldn't reconnect to the Kimi WebSocket",
  },
)
