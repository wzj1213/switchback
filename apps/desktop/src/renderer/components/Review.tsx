import { useEffect, useMemo, useState } from "react"
import { reviewLabel, type ReviewFile } from "../../shared/review.js"
import { filterFiles, tallyReview, useReview, usePatch } from "../review.js"
import { useModalKeys } from "../useModalKeys.js"
import { reveal, revealable } from "../reveal.js"
import { ReviewList } from "./ReviewList.js"
import { ReviewDiff } from "./ReviewDiff.js"
import { CopyIcon, RevealIcon } from "./icons.js"

/**
 * 审核：**提交之前把工作区里所有的改动逐个看一遍**。
 *
 * ## 它和变更汇总卡是两件事
 *
 * 汇总卡回答「它刚才动了多少」，就挂在输入框上方，扫一眼就走。
 * 审核回答「我现在要不要提交这些」——那是个要坐下来做的动作，所以它是一整块面板：
 * 左边逐个文件、右边完整补丁、可以并排看、可以把上下文展开。
 *
 * ## 数据来自 git，不是引擎报的编辑
 *
 * 引擎用 shell 写的文件、你自己改的、上一轮留下的，在引擎报的那份里一个都没有。
 * 而「要不要提交」问的是工作区的真实状态。见 `main/workdiff.ts`。
 *
 * ## 明确不做的一件事
 *
 * **不交给另一家引擎去审。** 那要为 agent 之间发明一套自制协议，是个无底洞
 *（见 `AGENTS.md` 的边界）。要另一双眼睛的话，把路径给它、让它自己读就行。
 */

const CONTEXT = [
  { n: 3, label: "3 行" },
  { n: 12, label: "12 行" },
  { n: 9999, label: "整个文件" },
] as const

/** 头上那行字。**「没有改动」和「不是 git 仓库」要说不同的话**——后者不是干净，是没法比。 */
function summary(noRepo: boolean, count: number, added: number, removed: number): React.JSX.Element {
  if (noRepo) return <span className="rv__count">这个工作区不是 git 仓库，没有可比的基线</span>
  if (count === 0) return <span className="rv__count">工作区是干净的</span>
  return (
    <>
      <span className="rv__count">{count} 个文件</span>
      {added > 0 ? <span className="diffstat__add">+{added}</span> : null}
      {removed > 0 ? <span className="diffstat__del">−{removed}</span> : null}
    </>
  )
}

/** 右边那片没东西可画的时候说什么。三种「空」的原因不同，说同一句话等于什么都没说。 */
export function blank(noRepo: boolean, loading: boolean, total: number, shown: number): string {
  if (loading) return "正在问 git…"
  if (noRepo) return "这个工作区不是 git 仓库，没有可比的基线"
  if (total === 0) return "工作区是干净的，没有要审的改动"
  if (shown === 0) return "没有匹配的文件，改一下上面的筛选词"
  return "左边选一个文件"
}

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

/** 头上那排开关。抽出来是行数闸门，但它本来就是一组独立的东西。 */
function Tools({ split, onSplit, context, onContext, onReload }: {
  split: boolean
  onSplit: (on: boolean) => void
  context: number
  onContext: (n: number) => void
  onReload: () => void
}): React.JSX.Element {
  return (
    <div className="rv__tools">
      {([true, false] as const).map((on) => (
        <button
          key={String(on)}
          type="button"
          className={`rv__seg${split === on ? " rv__seg--on" : ""}`}
          onClick={() => {
            onSplit(on)
          }}
        >
          {on ? "并排" : "单栏"}
        </button>
      ))}
      <span className="rv__gap" />
      {CONTEXT.map((c) => (
        <button
          key={c.n}
          type="button"
          className={`rv__seg${context === c.n ? " rv__seg--on" : ""}`}
          title="上下文行数"
          onClick={() => {
            onContext(c.n)
          }}
        >
          {c.label}
        </button>
      ))}
      <button type="button" className="rv__seg" onClick={onReload} title="重新问一遍 git">
        刷新
      </button>
    </div>
  )
}

/**
 * 右边那一片的文件头。
 *
 * 删掉的文件**不给「在访达里显示」**：它已经不在了，点了什么都不会发生——
 * 那正是这个仓库一直在避免的那种元素（见 `Diff.tsx` 里同一处判断）。
 */
function FileHead({ file, onReveal, onCopy }: {
  file: ReviewFile
  onReveal: () => void
  onCopy: () => void
}): React.JSX.Element {
  const canGo = file.kind !== "delete" && revealable(file.path)
  return (
    <div className="rv__file">
      <span className={`rvl__kind rvl__kind--${file.kind}`} aria-hidden="true" />
      <span className="rv__kindtext">{reviewLabel(file.kind)}</span>
      <span className="rv__path" title={file.rel}>
        {file.rel}
      </span>
      {canGo ? (
        <button type="button" className="rv__act" aria-label="在访达中显示" title="在访达中显示" onClick={onReveal}>
          <RevealIcon size={12} />
        </button>
      ) : null}
      <button type="button" className="rv__act" aria-label="复制这份补丁" title="复制这份补丁" onClick={onCopy}>
        <CopyIcon size={12} />
      </button>
    </div>
  )
}

export function Review({ cwd, stamp, onClose, onCopy }: {
  cwd: string
  /** 轮次戳：跑完一轮就重问一遍 git。 */
  stamp: string
  onClose: () => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  const box = useModalKeys(onClose)
  const data = useReview(cwd, stamp)
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const [split, setSplit] = useState(true)
  const [context, setContext] = useState<number>(3)
  const files = useMemo(() => filterFiles(data.files, query), [data.files, query])
  // 选中的那个被筛掉了（或者上一轮把它改回去了）就退回第一个——
  // 停在一个列表里已经没有的文件上，右边会一直是空的
  const active = files.some((f) => f.rel === picked) ? picked : files[0]?.rel
  const rels = useMemo(() => files.map((f) => f.rel), [files])
  useArrows(rels, active, setPicked)
  const patch = usePatch(cwd, active, context, stamp)
  const { added, removed } = tallyReview(data.files)
  const file = files.find((f) => f.rel === active)
  return (
    <div className="rv__scrim" role="presentation">
      <div className="rv" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label="审核改动">
        <header className="rv__head">
          <h2 className="rv__title">审核</h2>
          {summary(data.noRepo, data.files.length, added, removed)}
          <Tools split={split} onSplit={setSplit} context={context} onContext={setContext} onReload={data.reload} />
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
            {...(data.more === undefined ? {} : { more: data.more })}
          />
          <section className="rv__pane">
            {file === undefined ? (
              <p className="rvd__note">{blank(data.noRepo, data.loading, data.files.length, files.length)}</p>
            ) : (
              <>
                <FileHead
                  file={file}
                  onReveal={() => {
                    reveal(file.path)
                  }}
                  onCopy={() => {
                    onCopy(patch.patch === "" ? file.rel : patch.patch)
                  }}
                />
                <ReviewDiff
                  lines={patch.lines}
                  {...(patch.skip === undefined ? {} : { skip: patch.skip })}
                  split={split}
                  loading={patch.loading}
                />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
