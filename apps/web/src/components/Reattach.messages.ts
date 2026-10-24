import { defineMessages } from "@switchback/i18n"

/**
 * 没接引擎的会话底下那一块。档位照原样显示 id（`full` / `auto-edit`），和页脚「远程上限」一致。
 * 「接回来」英文用 resume（命令就叫 `thread.resume`），好和断网那个 reconnect 分开。
 */
export const REATTACH = defineMessages(
  {
    failed: "没接上。可能是引擎起不来，或者那个目录不在了——再试一次，或者去桌面上看看。",
    resume: "接回来就能接着说。",
    resumeWith: (engine: string) => `接回来由 ${engine} 接着做。`,
    lowered: (from: string, to: string) => `它开在「${from}」档，高过远程上限——接回来会先切到「${to}」。`,
    detached: (who: string, trust: string) => `这条会话现在没接引擎。${who}${trust}`,
    hopeless: "这条会话没留下引擎侧的句柄（旧版本记录），接不回来了。",
    waiting: "等重连…",
    fresh: "在同一个项目里开一条新的",
    going: "正在把它接回引擎…",
    goingHint: "引擎要重新起一个进程并载入上下文，通常几秒。",
    retry: "再试一次",
    go: "接回来，继续说",
  },
  {
    failed: "Couldn't resume it. The engine may have failed to start, or the folder is gone. Try again, or check on the desktop.",
    resume: "Resume it to keep going.",
    resumeWith: (engine) => `Resume it and ${engine} takes over.`,
    lowered: (from, to) => ` It was set to “${from}”, above the remote limit, so resuming switches it to “${to}” first.`,
    detached: (who, trust) => `This thread has no engine attached right now. ${who}${trust}`,
    hopeless: "This thread didn't keep the engine's session handle (it's an older record), so it can't be resumed.",
    waiting: "Waiting to reconnect…",
    fresh: "Start a new thread in the same project",
    going: "Resuming it in the engine…",
    goingHint: "The engine starts a new process and loads the context. This usually takes a few seconds.",
    retry: "Try again",
    go: "Resume and continue",
  },
)
