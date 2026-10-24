import { defineMessages } from "@switchback/i18n"

/** DSH 那张卡上的探测结果。profile 名、它自报的身份与 stderr 原样显示。 */
export const ACP_DSH = defineMessages(
  {
    badProfile: (json: string) => `DSH profile 名称无效：${json}`,
    cap: { list: "列表", resume: "续跑", fork: "分叉" },
    newOnly: "会话仅新建",
    sessions: (parts: readonly string[]) => `会话：${parts.join("/")}`,
    image: "图片提示",
    timeout: (seconds: number) => `DSH 在 ${String(seconds)} 秒内没有完成 ACP initialize。`,
    incompatible: "DSH 返回了 Switchback 不支持的 ACP initialize 结果。",
    install: (profile: string) => `请先安装 DSH，并配置名为 \`${profile}\` 的 ACP profile。`,
    handshakes: (profile: string) => `\`${profile}\` profile 可握手`,
    noAcp: (profile: string) =>
      `DSH 装着，但 \`${profile}\` 这棵 profile 没有应答 ACP。到「设置 → 引擎 → DSH」换一棵装了 ACP 插件的；\`dsh --profile ${profile}\` 能看它自己的报错。`,
  },
  {
    badProfile: (json) => `Invalid DSH profile name: ${json}`,
    cap: { list: "list", resume: "resume", fork: "fork" },
    newOnly: "new threads only",
    sessions: (parts) => `threads: ${parts.join("/")}`,
    image: "image prompts",
    timeout: (seconds) => `DSH didn't finish ACP initialize within ${String(seconds)} seconds.`,
    incompatible: "DSH returned an ACP initialize result Switchback doesn't support.",
    install: (profile) => `Install DSH first, then set up an ACP profile named \`${profile}\`.`,
    handshakes: (profile) => `\`${profile}\` profile completes the handshake`,
    noAcp: (profile) =>
      `DSH is installed, but the \`${profile}\` profile didn't answer ACP. Go to Settings → Engines → DSH and pick a profile with an ACP plugin; \`dsh --profile ${profile}\` shows its own errors.`,
  },
)
