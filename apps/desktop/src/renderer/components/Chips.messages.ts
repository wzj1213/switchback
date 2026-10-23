import { count, defineMessages } from "@switchback/i18n"

/** 输入区那排工作区芯片：本轮已放行、分支。 */
export const CHIPS = defineMessages(
  {
    passingTip: "这一轮剩下的审批都自动放行了（红线除外）。要收回：⌘. 中断这一轮",
    passing: "本轮已放行",
    detached: "HEAD 没指向任何分支（游离）——在这上面产生的提交不属于任何分支，切走之后就很难找回来了",
    branch: "当前分支",
    dirty: (head: string, n: number) => `${head}；${String(n)} 个文件有未提交的改动——引擎会在这些改动之上继续动手`,
  },
  {
    passingTip: "The rest of this turn's approvals are allowed automatically (red lines excepted). To take it back, press ⌘. to interrupt the turn.",
    passing: "Allowed this turn",
    detached: "HEAD isn't on any branch (detached). Commits made here belong to no branch and are hard to find once you switch away.",
    branch: "Current branch",
    dirty: (head, n) => `${head}. ${count(n, "file")} with uncommitted changes; the engine keeps working on top of them.`,
  },
)
