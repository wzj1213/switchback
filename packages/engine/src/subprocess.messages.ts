import { defineMessages } from "@switchback/i18n"

/** 引擎进程退出了：退出码与信号原样显示。 */
export const SUBPROCESS = defineMessages(
  { exited: (code: string, signal: string | null) => `进程已退出（code ${code}${signal === null ? "" : ` signal ${signal}`}）` },
  { exited: (code, signal) => `The process exited (code ${code}${signal === null ? "" : `, signal ${signal}`})` },
)
