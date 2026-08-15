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
 * ## 为什么每次切会话都重新问一遍
 *
 * 分支和脏不脏**随时会变**（用户在终端里切了分支）。缓存的代价是界面显示
 * 一个过期的分支名，而一个过期的分支名比不显示更危险。
 */

export function Chips({ cwd, project }: { cwd: string; project: string }): React.JSX.Element {
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
  }, [bridge, cwd])

  return (
    <div className="chips">
      <span className="chip" title={cwd}>
        <FolderIcon />
        {project}
      </span>
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
