import { defineMessages } from "@switchback/i18n"

/** 这台机器上为什么起不了注册表里的这一家。 */
export const ACP_PLAN = defineMessages(
  {
    noNpx: "它用 npx 分发，这台机器上没找到 npx（装 Node.js 会带上）",
    noUvx: "它用 uvx 分发，这台机器上没找到 uvx（装 uv 会带上）",
    noBuild: "它没有发布这个平台的包",
  },
  {
    noNpx: "It's distributed through npx, which isn't on this machine (installing Node.js adds it)",
    noUvx: "It's distributed through uvx, which isn't on this machine (installing uv adds it)",
    noBuild: "It hasn't published a package for this platform",
  },
)
