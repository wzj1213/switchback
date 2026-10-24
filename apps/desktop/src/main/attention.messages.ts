import { defineMessages } from "@switchback/i18n"

/**
 * 系统通知里的话。会话标题是你起的、审批摘要是引擎报的，都不翻译。
 * 时长的说法和渲染层 `status.messages.ts` 是同一套，改措辞时两处一起改。
 */
export const ATTENTION = defineMessages(
  {
    waiting: "Switchback 在等你确认",
    failed: (why: string) => `跑挂了：${why}`,
    noReason: "引擎没有说原因",
    done: (spent: string) => `跑完了，用了 ${spent}`,
    seconds: (s: number) => `${String(s)} 秒`,
    minutes: (min: number) => `${String(min)} 分`,
    minutesSeconds: (min: number, s: number) => `${String(min)} 分 ${String(s)} 秒`,
  },
  {
    waiting: "Switchback needs your approval",
    failed: (why) => `Failed: ${why}`,
    noReason: "The engine didn't say why",
    done: (spent) => `Done in ${spent}`,
    seconds: (s) => `${String(s)}s`,
    minutes: (min) => `${String(min)}m`,
    minutesSeconds: (min, s) => `${String(min)}m ${String(s)}s`,
  },
)
