import { BranchIcon } from "./icons.js"
import { FolderIcon } from "./icons-folder.js"
import { branchLabel, dirtyMark, useWorksite } from "../useWorksite.js"

/**
 * 输入区上方那一条：**这句话会发到哪儿去**。
 *
 * ## 为什么是分支而不是别的
 *
 * 「引擎会改到哪个分支」这件事，界面上以前一个字都没有。你在 `feature/x`
 * 上开了会话，去终端切到 `main` 做别的，回来接着让它改——它改的是 main。
 * 发生的当下没有任何提示，通常要等到 `git status` 才发现。
 *
 * 「有未提交的改动」是同一类信息：agent 在一堆脏改动上面继续动手，
 * 出问题时 `git diff` 里两个人的改动混在一起，分不出哪些是它做的。
 * 所以脏的时候那枚芯片标黄——不是报错，是提醒。
 *
 * ## 什么时候重新问
 *
 * 取数与时机全在 `useWorksite`——那里也解释了为什么焦点回来时要重问一次，
 * 以及为什么换工作区要清旧值、同一个工作区重问则不清。
 * 抽出去的直接原因是 `EnvCard` 抄了一份一模一样的，两份会分头走偏。
 *
 * ## 两种摆法，一份取数
 *
 * `compact` 关掉时它是输入卡里**自己一行**的题注（起手那一屏用）；
 * 打开时它缩进下面那一排控件里，只留真正会变的那枚。
 *
 * **不做成两个组件**：那正是 `EnvCard` 当年犯的错——同一件事两份实现，
 * 迟早在其中一份上加了「脏了标黄」而另一份没加。
 */

export function Chips({
  threadId,
  cwd,
  project,
  stamp,
  passing,
  compact = false,
}: {
  threadId: string
  cwd: string
  project: string
  /** 变一次就重新问一遍。调用方把轮次状态传进来。 */
  stamp: string
  /**
   * 这一轮已经点过「本轮剩下的都放行」。
   *
   * **一个「接下来不再问你」的开关必须看得见。** 只活在宿主内存里的话，
   * 屏幕上没有任何痕迹——而这恰恰是最不该沉默的一类状态。
   */
  passing: boolean
  /**
   * 缩进控件那一排（会话已经开工）。
   *
   * **项目名这时不再出现**：它一整条会话都不会变，而侧栏的分组和这条会话
   * 所在的位置已经在说同一句话。分支不同——你可能刚在终端里 `git switch`
   * 过，回来接着让它改，而改的是新分支。**会变的留下，不变的收走。**
   */
  compact?: boolean
}): React.JSX.Element {
  const git = useWorksite(threadId, cwd, stamp)
  const branch = branchLabel(git)

  return (
    <div className={compact ? "chips chips--bar" : "chips"}>
      {compact ? null : (
        <span className="chip" title={cwd}>
          <FolderIcon />
          <span className="chip__name">{project}</span>
        </span>
      )}
      {passing ? (
        <span className="chip chip--warn" title="这一轮剩下的审批都自动放行了（红线除外）。要收回：⌘. 中断这一轮">
          本轮已放行
        </span>
      ) : null}
      {branch === undefined ? null : (
        <span
          className={`chip${git.dirty === true ? " chip--warn" : ""}`}
          /* 缩进那一排之后项目名没了，工作区路径就挂到这枚上——
             「它到底在哪儿动手」不能只剩一个分支名 */
          title={`${compact ? `${cwd}\n` : ""}${branchTitle(git.detached === true, git.dirtyCount)}`}
        >
          <BranchIcon />
          <span className="chip__name">{branch}</span>
          {dirtyMark(git)}
        </span>
      )}
    </div>
  )
}

/**
 * 悬停说明。游离那句要说**后果**，不是复述状态——
 * 「游离 HEAD」四个字对不熟 git 的人等于没说，而这里真正要紧的是
 * 「在这上面提交的东西不属于任何分支，切走就找不着了」。
 */
function branchTitle(detached: boolean, dirtyCount: number | undefined): string {
  const head = detached
    ? "HEAD 没指向任何分支（游离）——在这上面产生的提交不属于任何分支，切走之后就很难找回来了"
    : "当前分支"
  if (dirtyCount === undefined || dirtyCount === 0) return head
  return `${head}；${String(dirtyCount)} 个文件有未提交的改动——引擎会在这些改动之上继续动手`
}
