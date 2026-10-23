import { defineMessages } from "@switchback/i18n"

/** 侧边面板的「活动」页：引擎公开的后台任务。标题与输出是引擎报的，不翻译。 */
export const ACTIVITY_PAGE = defineMessages(
  {
    status: { running: "正在运行", paused: "已暂停", done: "已完成", failed: "失败" },
    nodes: (n: number) => ` · ${String(n)} 个节点`,
    none: "这条任务还没有后台活动。",
    process: "过程",
    output: "输出片段",
    all: "全部活动",
    noDetail: "引擎只报告了这条活动的存在，还没有给出逐步明细。",
  },
  {
    status: { running: "Running", paused: "Paused", done: "Done", failed: "Failed" },
    nodes: (n) => ` · ${String(n)} nodes`,
    none: "This thread has no background activity yet.",
    process: "Steps",
    output: "Output",
    all: "All activity",
    noDetail: "The engine reported that this activity exists but hasn't given step-by-step details yet.",
  },
)
