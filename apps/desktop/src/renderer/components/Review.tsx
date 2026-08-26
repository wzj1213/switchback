import { useEffect, useMemo, useState } from "react"
import { filterFiles, tallyReview, untrackedCount, useReview, usePatch } from "../review.js"
import { usePanelKeys } from "../use-panel-keys.js"
import { ReviewList } from "./ReviewList.js"
import { Tools } from "./ReviewTools.js"
import { blank, ReviewSummary } from "./review-empty.js"
import { ReviewPane } from "./review-pane.js"

/**
 * 审核：**把这次对话最终留下的净改动逐个看一遍**。
 *
 * ## 它和变更汇总卡是两件事
 *
 * 汇总卡回答「会话触达的文件现在净改了多少」，就挂在输入框上方，扫一眼就走。
 * 审核回答「这次对话最终留下了什么」——那是个要坐下来做的动作，所以它是一整块面板：
 * 左边逐个文件、右边完整补丁、可以并排看、可以把上下文展开。
 *
 * ## 数据来自 git，不是引擎报的编辑
 *
 * 引擎用 shell 写的文件、你自己改的，在引擎报的那份里一个都没有。
 * 主进程因此比较对话开场与当前工作树。见 `main/worktree-baseline.ts`。
 *
 * ## 明确不做的一件事
 *
 * **不交给另一家引擎去审。** 那要为 agent 之间发明一套自制协议，是个无底洞
 *（见 `AGENTS.md` 的边界）。要另一双眼睛的话，把路径给它、让它自己读就行。
 */

/** ↑/↓ 在文件之间走。**在筛选框里也生效**：一边打字一边翻是这类面板的常规用法。 */
function useArrows(rels: readonly string[], active: string | undefined, onPick: (rel: string) => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
      if (rels.length === 0) return
      event.preventDefault()
      const at = active === undefined ? -1 : rels.indexOf(active)
      const step = event.key === "ArrowDown" ? 1 : -1
      const next = rels[(at + step + rels.length) % rels.length]
      if (next !== undefined) onPick(next)
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
    }
  }, [rels, active, onPick])
}

function ignoredOf(paths: readonly string[] | undefined): readonly string[] {
  return paths === undefined ? [] : paths
}

export function Review({ cwd, threadId, stamp, wanted, full, onFull, onClose, onCopy }: {
  cwd: string
  threadId: string
  /** 轮次戳：跑完一轮就重问一遍 git。 */
  stamp: string
  /** 引擎明确上报过的路径；Git 忽略项也必须诚实地出现在审核状态里。 */
  wanted: readonly string[]
  full: boolean
  onFull: () => void
  onClose: () => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  const box = usePanelKeys(onClose)
  const data = useReview(cwd, stamp, { threadId, wanted })
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const [split, setSplit] = useState(true)
  const [context, setContext] = useState<number>(3)
  const [untracked, setUntracked] = useState(true)
  const files = useMemo(() => filterFiles(data.files, query, untracked), [data.files, query, untracked])
  const untrackedN = untrackedCount(data.files)
  // 选中的那个被筛掉了（或者上一轮把它改回去了）就退回第一个——
  // 停在一个列表里已经没有的文件上，右边会一直是空的
  const active = files.some((f) => f.rel === picked) ? picked : files[0]?.rel
  const rels = useMemo(() => files.map((f) => f.rel), [files])
  useArrows(rels, active, setPicked)
  const patch = usePatch(cwd, active, { context, stamp, threadId, revision: data.revision })
  const { added, removed } = tallyReview(data.files)
  const total = data.files.length + (data.more ?? 0)
  const ignored = ignoredOf(data.ignored)
  const unverified = ignored.length
  const file = files.find((f) => f.rel === active)
  return (
    <section className="rv" ref={box} tabIndex={-1} aria-label="审核改动">
      <header className="rv__head">
        <h2 className="rv__title">审核</h2>
        <div className="rv__summary">
          <ReviewSummary
            state={{ noRepo: data.noRepo, loading: data.loading, failed: data.failed,
              baseline: data.baseline, total, unverified,
              ...(data.more === undefined ? {} : { more: data.more }) }}
            added={added}
            removed={removed}
          />
        </div>
          <Tools
            split={split}
            onSplit={setSplit}
            context={context}
            onContext={setContext}
            onReload={data.reload}
            {...(untrackedN === 0 ? {} : { untracked: { on: untracked, count: untrackedN, onToggle: setUntracked } })}
          />
          <button type="button" className="rv__expand"
            aria-label={full ? "并排显示审核" : "展开审核"}
            title={full ? "并排显示审核" : "展开审核"} onClick={onFull}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
              strokeWidth="1.5" aria-hidden="true">
              <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" />
            </svg>
          </button>
          <button type="button" className="rv__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
      </header>
      <div className="rv__body">
        <ReviewList
          files={files}
          active={active}
          query={query}
          onQuery={setQuery}
          onPick={setPicked}
          ignored={ignored}
          {...(data.more === undefined ? {} : { more: data.more })}
        />
        <ReviewPane
          file={file}
          patch={patch}
          empty={blank({
            noRepo: data.noRepo,
            loading: data.loading,
            failed: data.failed,
            baseline: data.baseline,
            total,
            shown: files.length,
            unverified,
            ...(data.more === undefined ? {} : { more: data.more }),
          })}
          split={split}
          onCopy={onCopy}
        />
      </div>
    </section>
  )
}
