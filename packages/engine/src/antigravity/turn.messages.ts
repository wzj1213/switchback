import { defineMessages } from "@switchback/i18n"

/** 一轮的原生进程出岔子时说的话。它自己的 stderr 优先，原样显示。 */
export const AGY_TURN = defineMessages(
  {
    noPipes: "Antigravity 缺少 stdio 管道",
    stuck: "Antigravity 进程树未能退出，请检查原生进程",
    unparseable: (message: string) => `Antigravity stream-json 无法解析：${message}`,
    leftover: "Antigravity 退出后仍有子进程未能回收，请检查原生进程",
    noResult: (code: string, signal: string | undefined) =>
      `Antigravity 未返回 result 就退出（code ${code}${signal === undefined ? "" : `，${signal}`}）`,
  },
  {
    noPipes: "Antigravity has no stdio pipes",
    stuck: "The Antigravity process tree didn't exit; check its native processes",
    unparseable: (message) => `Couldn't parse Antigravity's stream-json: ${message}`,
    leftover: "Child processes were still running after Antigravity exited; check its native processes",
    noResult: (code, signal) => `Antigravity exited without returning a result (code ${code}${signal === undefined ? "" : `, ${signal}`})`,
  },
)
