import { defineMessages } from "@switchback/i18n"

/** codex 起不来、开不了会话时说的话。命令、退出原文、stderr 原样带上。 */
export const CODEX_OPEN = defineMessages(
  {
    notFound: (command: string) =>
      `找不到可执行文件 \`${command}\`。设置 → 安装与接入 → 安装与版本 里可以直接装；已经装过的话，去那儿点「重新探测」（终端里跑 \`which codex\` 能看出是不是 PATH 的问题）。`,
    noPermission: (command: string) => `没有权限执行 \`${command}\`。`,
    failed: (command: string, why: string) => `启动 \`${command}\` 失败：${why}`,
    noThreadId: "codex 没有返回 thread id，无法继续",
    opening: { fork: "分叉会话（thread/fork）", resume: "续接会话（thread/resume）", start: "新建会话（thread/start）" },
    openTimeout: (seconds: number, what: string, tail: string) => `codex 在 ${String(seconds)} 秒内没有完成${what}，已停止并回收进程。${tail}`,
    handshakeTimeout: (seconds: number, tail: string) => `codex 在 ${String(seconds)} 秒内没有完成握手，已停止并回收进程。${tail}`,
  },
  {
    notFound: (command) =>
      `Can't find the executable \`${command}\`. You can install it from Settings → Install & connect → Install and versions; if it's already installed, click “Detect again” there (running \`which codex\` in a terminal shows whether it's a PATH problem).`,
    noPermission: (command) => `No permission to run \`${command}\`.`,
    failed: (command, why) => `Couldn't start \`${command}\`: ${why}`,
    noThreadId: "codex didn't return a thread id, so it can't continue",
    opening: { fork: "fork the thread (thread/fork)", resume: "resume the thread (thread/resume)", start: "start a thread (thread/start)" },
    openTimeout: (seconds, what, tail) => `codex didn't ${what} within ${String(seconds)}s, so it was stopped and its process reclaimed.${tail}`,
    handshakeTimeout: (seconds, tail) => `codex didn't finish the handshake within ${String(seconds)}s, so it was stopped and its process reclaimed.${tail}`,
  },
)
