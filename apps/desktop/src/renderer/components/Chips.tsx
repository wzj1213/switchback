import { useEffect, useState } from "react"
import { BranchIcon, FolderIcon } from "./icons.js"

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
 * 切会话时，**以及每一轮开始和结束时**。分支会被用户在终端里改掉，
 * 而「脏不脏」更是引擎自己每改一个文件就变一次——第一版只在切会话时问一遍，
 * 于是它跑完一轮改了三个文件，芯片还显示着「干净」。
 * 一个过期的状态比不显示更危险，这条对分支和脏都成立。
 */

export function Chips({
  cwd,
  project,
  stamp,
  passing,
}: {
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
}): React.JSX.Element {
  const [git, setGit] = useState<{ branch?: string; dirty?: boolean }>({})
  const bridge = typeof window === "undefined" ? undefined : window.omni

  useEffect(() => {
    if (bridge === undefined) return undefined
    let live = true
    // 切走之后回来的那次响应不能再往界面上写：那时显示的已经是另一个工作区了
    void bridge.worksite(cwd).then((info) => {
      if (live) setGit(info)
    })
    return () => {
      live = false
    }
  }, [bridge, cwd, stamp])

  return (
    <div className="chips">
      <span className="chip" title={cwd}>
        <FolderIcon />
        {project}
      </span>
      {passing ? (
        <span className="chip chip--warn" title="这一轮剩下的审批都自动放行了（红线除外）。要收回：⌘. 中断这一轮">
          本轮已放行
        </span>
      ) : null}
      {git.branch === undefined ? null : (
        <span
          className={`chip${git.dirty === true ? " chip--warn" : ""}`}
          title={git.dirty === true ? "工作区有未提交的改动——引擎会在这些改动之上继续动手" : "当前分支"}
        >
          <BranchIcon />
          {git.branch}
          {git.dirty === true ? " ·" : ""}
        </span>
      )}
    </div>
  )
}
