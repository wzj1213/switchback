import { useCallback, useState } from "react"
import type { Item } from "@omni/protocol"
import { changeEvidenceOf, reconcileChanges, reportedChangesOf } from "../changes.js"
import { useReview } from "../review.js"
import { ChangedList } from "./changed-list.js"
import { ChangedHead, type ReportReason } from "./changed-head.js"
import { Popover } from "./Popover.js"
import { changeNote } from "../changed-note.js"

interface Props {
  items: readonly Item[]
  threadId: string
  cwd: string
  stamp: string
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onReview: () => void
}

/** 清单浮层的宽度。够一行放下「两级目录 / 文件名 +12 −4」再加三颗行内动作。 */
const POP_WIDTH = 460

/**
 * 这张卡这一帧该不该出现。
 *
 * **「正在问 git」只在还没有任何答案时才藏**。上一版是 `state.loading` 一真就藏，
 * 而 `loading` 在**重问**期间也是真的——于是切走再切回来（`window.focus` 触发重问）
 * 时，这张卡会整张消失再装回来，看起来就是闪了一下。
 *
 * 手上有旧答案就接着显示旧的：`useReview` 本来就特意不清空它
 *（「清空会让面板在每一轮结束时闪一下白」），这里跟上那条。
 */
export function shouldHide(state: {
  loading: boolean
  settled: boolean
  failed: boolean
  files: number
  others: number
}): boolean {
  if (state.loading && !state.settled) return true
  return state.files === 0 && state.others === 0 && !state.failed
}

/** 只有引擎一面之词时，是哪一种「核不了」。三选一，按能确定的先后排。 */
export function reasonOf(state: { noRepo: boolean; failed: boolean; settled: boolean }): ReportReason {
  if (state.noRepo) return "noRepo"
  return state.failed ? "failed" : "pending"
}

/**
 * 会话触达文件的当前净变更：总数 → 文件清单 → git 实时补丁。
 *
 * ## 展开的那张清单是**浮层**，不是这一行长高
 *
 * 上一版展开是就地摊开：`.changed` 占满整行，卡片长出一张最高 36vh 的表。
 * 它住在输入框上方那条状态带里，而那条带子是**版面里的一格**——它长高多少，
 * 转录区就矮多少。于是「看一眼刚才改了哪些文件」的代价是**正文当场缩掉三分之一**，
 * 你还没看完清单，上下文已经被挤没了；关掉之后正文又弹回来，读到哪儿也丢了。
 *
 * 现在它借 `Popover` 浮在正文上面：位置贴着摘要那颗按钮，点外面或 Esc 关闭，
 * 版面一个像素都不动。**这也和这条带子的初衷一致**——它的验收数是
 *「输入框上方最多几行：1」，一个会把自己撑成半屏的展开态从来就不该住在那儿。
 */
export function Changed({
  items,
  threadId,
  cwd,
  stamp,
  onReveal,
  onCopy,
  onReview,
}: Props): React.JSX.Element | null {
  const reported = reportedChangesOf(items, cwd)
  const review = useReview(cwd, stamp, {
    threadId,
    wanted: reported.list.map((file) => file.path),
  })
  const evidence = changeEvidenceOf(review)
  const gitKnown = evidence !== "reported"
  const { files, added, removed, list } = gitKnown
    ? reconcileChanges(reported, review.files, review.root, {
        reported: cwd,
        real: review.cwd,
        ...(review.ignored === undefined ? {} : { ignored: review.ignored }),
      })
    : reported
  // **默认收起。** 它钉在输入框上方那一行里，和计划那枚药丸并排——
  // 一进来就摊开一张卡的话，那一行就又变回了上一版那条通栏带子
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const close = useCallback(() => {
    setOpen(false)
  }, [])
  const mine = new Set(list.flatMap((file) => file.review?.rel ?? []))
  const minePaths = new Set(list.map((file) => file.path))
  const others = evidence === "baseline"
    ? review.files.filter((file) => !mine.has(file.rel) && !minePaths.has(file.path))
    : []
  // `more` 是整个 Git 查询被截断的余量；只有开场基线能把它归到这次对话。
  // HEAD 回退若带进来，会把仓库里无关的海量脏文件重新画成历史会话改动。
  const othersTotal = evidence === "baseline" ? others.length + (review.more ?? 0) : 0
  if (
    shouldHide({
      loading: review.loading,
      settled: review.settled,
      failed: review.failed,
      files,
      others: othersTotal,
    })
  ) {
    return null
  }
  return (
    <section className="changed" data-open={open} aria-label="文件改动摘要">
      <div className="changed__card">
        <ChangedHead
          files={files}
          others={othersTotal}
          added={added}
          removed={removed}
          failed={review.failed}
          evidence={evidence}
          reason={reasonOf(review)}
          open={open}
          anchor={setAnchor}
          onOpen={() => {
            setOpen((was) => !was)
          }}
          onReview={onReview}
        />
      </div>
      {/* **不给 `contentKey`**：那是「菜单换页了，把焦点带回第一项」用的。
          这里点「再显示 6 个文件」只是同一张清单变长，焦点该留在刚点的那颗上 */}
      <Popover open={open} onClose={close} anchor={anchor} minWidth={POP_WIDTH}
        ariaLabel="这条会话改过的文件">
        <ChangedList
          files={list}
          others={others}
          othersTotal={othersTotal}
          all={all}
          cwd={cwd}
          stamp={`${stamp}\u0000${review.revision}`}
          threadId={threadId}
          note={changeNote(review, list)}
          onReveal={onReveal}
          onCopy={onCopy}
          onAll={() => {
            setAll((was) => !was)
          }}
        />
      </Popover>
    </section>
  )
}
