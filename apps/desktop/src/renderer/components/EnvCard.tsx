import { useEffect, useState } from "react"
import type { EngineInfo, Thread } from "@omni/protocol"
import { Popover } from "./Popover.js"
import { BranchIcon, CopyIcon, EngineIcon, FolderIcon, RevealIcon, ShieldIcon } from "./icons.js"
import { FileIcon } from "./icons-activity.js"
import type { ProjectDoc } from "../../main/projectdoc.js"
import { labelOf } from "./Composer.js"
import { branchLabel, useWorksite } from "../useWorksite.js"

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
  // 每次打开都重新问一次（这张卡随浮层挂载）。取数时机与「换工作区清旧值」
  // 都在 `useWorksite` 里，和 `Chips` 共用一份——两份会分头走偏
  const git = useWorksite(thread.cwd, "open")
  const branch = branchLabel(git)
  const [doc, setDoc] = useState<ProjectDoc | undefined>(undefined)
  const bridge = typeof window === "undefined" ? undefined : window.omni

  useEffect(() => {
    if (bridge === undefined) return undefined
    let live = true
    void bridge.projectDoc(thread.cwd).then((info) => {
      if (live) setDoc(info)
    })
    return () => {
      live = false
    }
  }, [bridge, thread.cwd])

  return (
    <Popover open anchor={anchor} minWidth={260} ariaLabel="环境信息" onClose={onClose}>
      <div className="env">
        <div className="env__title">环境信息</div>
        <Line icon={<FolderIcon />} label="工作区">
          <bdi>{thread.cwd}</bdi>
        </Line>
        {branch === undefined ? null : (
          <Line icon={<BranchIcon />} label="分支">
            {branch}
            {git.dirtyCount === undefined || git.dirtyCount === 0 ? null : (
              <span className="env__warn">{git.dirtyCount} 个文件未提交</span>
            )}
          </Line>
        )}
        <Line icon={<EngineIcon />} label="引擎">
          {labelOf(engines, thread.engine)}
          {thread.model === undefined ? "" : ` · ${thread.model}`}
        </Line>
        <Line icon={<ShieldIcon />} label="信任档">
          {TRUST_TEXT[thread.trust]}
        </Line>
        <Line icon={<FileIcon size={15} />} label="说明">
          <ProjectDocLine cwd={thread.cwd} doc={doc} onDoc={setDoc} />
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

/** 三档的名字必须和输入框那个选择器**逐字一致**，理由见 `Composer.tsx` 的 `TRUSTS`。 */
const TRUST_TEXT = {
  "read-only": "只读——只读操作可执行，修改与联网会被拒绝",
  "auto-edit": "自动审批——优先使用引擎原生安全评审",
  full: "完全访问——允许工作区外操作与联网",
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

/**
 * 项目说明那一行。三种状态各说各的话：
 *
 * - 都齐了 → 点开看
 * - 有 `AGENTS.md` 但 Claude 读不到 → 建一行指路牌
 * - 两份各写各的 → **不替他合并**，只说一声让他自己看
 *
 * 最后那条尤其重要：他自己写过的 `CLAUDE.md` 是他的内容，
 * 我们没有资格替他扔掉——所以那种情况只提示，不动手。
 */
function ProjectDocLine({
  cwd,
  doc,
  onDoc,
}: {
  cwd: string
  doc: ProjectDoc | undefined
  onDoc: (next: ProjectDoc) => void
}): React.JSX.Element {
  const bridge = typeof window === "undefined" ? undefined : window.omni
  if (doc === undefined) return <>…</>
  if (doc.agents && doc.linked) {
    return (
      <button
        type="button"
        className="env__link"
        onClick={() => {
          bridge?.openProjectDoc(cwd)
        }}
      >
        AGENTS.md（Claude 也读这份）
      </button>
    )
  }
  if (doc.agents && doc.claude && !doc.linked) {
    return (
      <button
        type="button"
        className="env__link"
        onClick={() => {
          bridge?.openProjectDoc(cwd)
        }}
      >
        两份说明各写各的 · 打开看看
      </button>
    )
  }
  return (
    <button
      type="button"
      className="env__link"
      onClick={() => {
        void bridge?.ensureProjectDoc(cwd).then(onDoc)
      }}
    >
      {doc.agents ? "有 AGENTS.md，但 Claude 还读不到 · 建立指向" : "还没有项目说明 · 建一份"}
    </button>
  )
}
