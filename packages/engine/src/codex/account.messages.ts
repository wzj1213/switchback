import { defineMessages } from "@switchback/i18n"

/** 开工前问账号：没登录就先说。 */
export const CODEX_ACCOUNT = defineMessages(
  { signedOut: "codex 还没登录，这个会话发什么都会失败。在终端里跑 `codex login`，然后重开一个会话。" },
  { signedOut: "codex isn't signed in, so anything sent in this thread will fail. Run `codex login` in a terminal, then open a new thread." },
)
