import { defineMessages } from "@switchback/i18n"

/** 远程服务端在 HTTP 回包里直接写给人看的话。 */
export const REMOTE_SERVER = defineMessages(
  {
    fenceHint: "在那台 Mac 上打开 Switchback → 设置 → 远程访问，把「隧道那头的域名」填成你现在地址栏里的 host[:端口]（不要带 https://）",
    wsOnly: "这条路径只接受 WebSocket 升级",
  },
  {
    fenceHint: "On the host Mac, open Switchback → Settings → Remote access and set “Tunnel host name” to the host[:port] in your address bar right now (without https://)",
    wsOnly: "This path only accepts a WebSocket upgrade",
  },
)
