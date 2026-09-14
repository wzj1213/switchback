import { useMemo, useRef, useState } from "react"
import { reportedReviewFile, type TurnReviewTarget } from "../turn-review.js"
import { filterFiles } from "../review.js"
import { usePanelKeys } from "../use-panel-keys.js"
import { useNarrowPanel } from "../use-narrow-panel.js"
import { PanelTabs, type PanelTabsProps } from "./PanelTabs.js"
import { ReviewList } from "./ReviewList.js"
import { ReviewNavigationBar } from "./review-navigation-bar.js"
import { ReportedReviewPane } from "./reported-review-pane.js"
import { FileListIcon } from "./icons-panel.js"

const initialPath = (target: TurnReviewTarget): string | undefined => target.path ?? target.edits.list[0]?.path

/** 新的点击意图在 render 当下生效，不等 effect 才清掉旧文件或筛选。 */
function useReportSelection(target: TurnReviewTarget) {
  const [selection, setSelection] = useState({ target, path: initialPath(target) })
  const [filter, setFilter] = useState({ target, value: "" })
  return {
    picked: selection.target === target ? selection.path : initialPath(target),
    query: filter.target === target ? filter.value : "",
    setQuery: (value: string): void => { setFilter({ target, value }) },
    setPicked: (path: string | undefined): void => { setSelection({ target, path }) },
  }
}

export function ReportedReview({ target, panel, panelActive, onClose, onCopy, onGit }: {
  target: TurnReviewTarget
  panel: PanelTabsProps
  panelActive: boolean
  onClose: () => void
  onCopy: (text: string) => unknown
  onGit: () => void
}): React.JSX.Element {
  const box = usePanelKeys(onClose, panelActive)
  const pane = useRef<HTMLElement>(null)
  const narrow = useNarrowPanel(pane)
  const { picked, query, setQuery, setPicked } = useReportSelection(target)
  const [list, setList] = useState(target.edits.files > 1)
  const [split, setSplit] = useState(false)
  const [wrap, setWrap] = useState(true)
  const all = useMemo(() => target.edits.list.map((file) => reportedReviewFile(file, target.cwd)), [target])
  const files = useMemo(() => filterFiles(all, query), [all, query])
  const active = files.find((file) => file.path === picked) ?? files[0]
  const file = target.edits.list.find((file) => file.path === active?.path)
  const pick = (rel: string): void => { setPicked(all.find((file) => file.rel === rel)?.path) }
  const switchSplit = (): void => {
    setSplit(true)
    if (narrow) { setList(false); if (!panel.full) panel.onFull() }
  }
  return (
    <section className="rv" ref={box} tabIndex={-1} aria-label="审核改动" hidden={!panelActive}>
      <PanelTabs {...panel} />
      <header className="rv__head">
        <span className="rv__title">本轮改动</span>
        <div className="rv__summary"><span className="rv__count">{all.length} 个文件</span>
          <span className="diffstat__add">+{target.edits.added}</span>
          <span className="diffstat__del">−{target.edits.removed}</span>
        </div>
        <div className="rv__tools">
          <button type="button" className="rv__seg" aria-pressed={!split || narrow}
            onClick={() => { setSplit(false) }}>单栏</button>
          <button type="button" className="rv__seg" aria-pressed={split && !narrow}
            onClick={switchSplit}>并排</button>
          <button type="button" className="rv__tool" aria-label={list ? "隐藏文件" : "显示文件"}
            onClick={() => { setList(!list) }}><FileListIcon /></button>
          <button type="button" className="rv__seg" onClick={onGit}>Git 差异</button>
        </div>
      </header>
      <ReviewNavigationBar files={files} active={active?.rel} onPick={pick} wrap={wrap} onWrap={setWrap} fixedWrap={split && !narrow} />
      <div className={`rv__body${list ? "" : " rv__body--list-hidden"}`}>
        <ReviewList files={files} active={active?.rel} query={query} onQuery={setQuery} onPick={pick} ignored={[]} />
        <section className="rv__pane" ref={pane}>
          {file === undefined ? <p className="rvd__note">没有匹配的文件</p> : (
            <ReportedReviewPane key={`${target.turnId}:${String(target.at)}:${file.path}`} file={file} cwd={target.cwd} threadId={target.threadId}
              split={split && !narrow} wrap={wrap} onCopy={onCopy} onGit={onGit} />
          )}
        </section>
      </div>
    </section>
  )
}
