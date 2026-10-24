import { defineMessages } from "@switchback/i18n"

/** 设置页上 Claude 那张卡片的探测提示。 */
export const CLAUDE_EXECUTABLE = defineMessages(
  {
    thin: "轻量版不内置 Claude，请先安装 Claude Code。",
    bundled: "PATH 上没有 `claude`，但完整版会使用 SDK 内置版本；真起不来时再显示引擎原话。",
  },
  {
    thin: "This lightweight build doesn't bundle Claude; install Claude Code first.",
    bundled: "`claude` isn't on PATH, but the full build uses the SDK's bundled version; if it really can't start, the engine's own message is shown.",
  },
)
