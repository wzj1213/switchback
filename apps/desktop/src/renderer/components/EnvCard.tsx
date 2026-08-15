import { useEffect, useState } from "react"
import type { EngineInfo, Thread } from "@omni/protocol"
import { Popover } from "./Popover.js"
import { BranchIcon, CopyIcon, EngineIcon, FolderIcon, RevealIcon, ShieldIcon } from "./icons.js"
import { labelOf } from "./Composer.js"

/**
 * 「这个会话跑在什么环境里」——一张卡片答完。
 *
 * ## 为什么单独做一张，而不是把这些字都摆在界面上
 *
 * 这些信息**平时都在**，只是散着：工作区在顶栏标题里（还只是目录名），
 * 分支在输入框上方的芯片里，引擎和信任档在输入区最下面一行，
 * 模型在它旁边，完整路径哪儿都没有。
 *
 * 平时散着是对的——每一样都贴在它最相关的地方。但有一个时刻你要的是**全部**：
 * 「我到底在哪儿、用谁、什么权限，跑之前再确认一遍」。尤其在
 * 好几个会话之间切来切去、或者刚接力换过引擎之后。为那一刻做一张卡片。
 *
 * 参照 codex 的 `环境信息`（`codex.localConversation.environmentSummary`）。
 * 它把这块常驻在右栏；这里做成按需打开的浮层——**右栏要占掉一条常驻的宽度**，
 * 而这些字一天看不了两回。
 */
export function EnvCard({
  thread,
  engines,
  anchor,
  onClose,
  onReveal,
  onCopy,
}: {
  thread: Thread
  engines: readonly EngineInfo[]
  anchor: HTMLElement | null
  onClose: () => void
  onReveal: (path: string) => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  const [git, setGit] = useState<{ branch?: string; dirty?: boolean }>({})
  const bridge = typeof window === "undefined" ? undefined : window.omni

  // 每次打开都重新问一次。分支会被用户在终端里改掉，而一个过期的分支名
  // 比不显示更危险——这条和 `Chips.tsx` 是同一个道理
  useEffect(() => {
    if (bridge === undefined) return undefined
    let live = true
    void bridge.worksite(thread.cwd).then((info) => {
      if (live) setGit(info)
    })
    return () => {
      live = false
    }
  }, [bridge, thread.cwd])

  return (
    <Popover open anchor={anchor} minWidth={260} onClose={onClose}>
      <div className="env">
        <div className="env__title">环境信息</div>
        <Line icon={<FolderIcon />} label="工作区">
          <bdi>{thread.cwd}</bdi>
        </Line>
        {git.branch === undefined ? null : (
          <Line icon={<BranchIcon />} label="分支">
            {git.branch}
            {git.dirty === true ? <span className="env__warn">有未提交的改动</span> : null}
          </Line>
        )}
        <Line icon={<EngineIcon />} label="引擎">
          {labelOf(engines, thread.engine)}
          {thread.model === undefined ? "" : ` · ${thread.model}`}
        </Line>
        <Line icon={<ShieldIcon />} label="信任档">
          {TRUST_TEXT[thread.trust]}
        </Line>
        {thread.engineHistory.length <= 1 ? null : (
          <Line icon={<EngineIcon />} label="接力过">
            {thread.engineHistory.map((e) => labelOf(engines, e)).join(" → ")}
          </Line>
        )}
        <div className="env__acts">
          <button
            type="button"
            className="btn btn--slim"
            onClick={() => {
              onReveal(thread.cwd)
            }}
          >
            <RevealIcon size={12} />
            在访达中显示
          </button>
          {/* codex 那张卡片上唯一一颗按钮就是「复制分支名称」——
              因为分支名是这里面**最常要粘到别处去**的一个（切分支、提 PR） */}
          <button
            type="button"
            className="btn btn--slim"
            disabled={git.branch === undefined}
            onClick={() => {
              if (git.branch !== undefined) onCopy(git.branch)
            }}
          >
            <CopyIcon size={12} />
            复制分支名
          </button>
        </div>
      </div>
    </Popover>
  )
}

const TRUST_TEXT = {
  "read-only": "只读——任何写入与命令都拒绝",
  "auto-edit": "自动编辑——工作区内的改动直接放行",
  full: "完全访问——只在红线上问",
} as const

function Line({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="env__line">
      <span className="env__icon">{icon}</span>
      <span className="env__label">{label}</span>
      <span className="env__value">{children}</span>
    </div>
  )
}
