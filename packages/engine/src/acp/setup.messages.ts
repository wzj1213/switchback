import { defineMessages } from "@switchback/i18n"

/** 开场与换模型时的几句：重名模型补 id、换不了的原因、起不来的原因、没标题的历史。 */
export const ACP_SETUP = defineMessages(
  {
    withId: (label: string, id: string) => `${label}（${id}）`,
    action: { model: "换模型", effort: "设推理强度" },
    failed: (engine: string, what: string, text: string) => `${engine} ${what}失败：${text}`,
    unsupported: (engine: string, what: string) =>
      `${engine} 这个适配器不支持在会话里${what}（对应的 ACP 方法它没实现）。要改就去它自己的界面或配置里改，改完新开一条会话。`,
    notFound: (command: string) =>
      `找不到可执行文件 \`${command}\`。请确认这个 ACP 适配器已安装且在 PATH 上（终端里跑 \`which ${command}\` 验证）；装好之后在 设置 → 安装与接入 → 安装与版本 点「重新探测」即可，不用重启。`,
    noPermission: (command: string) => `没有权限执行 \`${command}\`。`,
    startFailed: (command: string, message: string) => `启动 \`${command}\` 失败：${message}`,
    untitled: "（没有标题）",
  },
  {
    withId: (label, id) => `${label} (${id})`,
    action: { model: "switch models", effort: "set the reasoning level" },
    failed: (engine, what, text) => `${engine} couldn't ${what}: ${text}`,
    unsupported: (engine, what) =>
      `The ${engine} adapter can't ${what} inside a thread (it doesn't implement that ACP method). Change it in its own interface or config, then start a new thread.`,
    notFound: (command) =>
      `Can't find the executable \`${command}\`. Make sure this ACP adapter is installed and on PATH (run \`which ${command}\` in a terminal to check); once it's installed, click “Detect again” in Settings → Install & connect → Install and versions. No restart needed.`,
    noPermission: (command) => `No permission to run \`${command}\`.`,
    startFailed: (command, message) => `Couldn't start \`${command}\`: ${message}`,
    untitled: "(untitled)",
  },
)
