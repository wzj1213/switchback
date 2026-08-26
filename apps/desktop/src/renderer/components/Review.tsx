import { useMemo, useState } from "react"
import { filterFiles, tallyReview, useReview, usePatch } from "../review.js"
import { usePanelKeys } from "../use-panel-keys.js"
import { ReviewList } from "./ReviewList.js"
import { Tools } from "./ReviewTools.js"
import { blank, ReviewSummary } from "./review-empty.js"
import { ReviewPane } from "./review-pane.js"
import { PanelTabs, type PanelTabsProps } from "./PanelTabs.js"
import { Select } from "./Select.js"
import type { ReviewScope } from "../../shared/review.js"

const SCOPES: readonly { id: ReviewScope; label: string; description: string }[] = [
  { id: "last-turn", label: "上一轮", description: "只看最近一次发送之后留下的改动" },
  { id: "uncommitted", label: "未提交", description: "当前工作区相对 HEAD 的全部改动" },
  { id: "unstaged", label: "未暂存", description: "尚未加入暂存区的改动与新文件" },
  { id: "staged", label: "已暂存", description: "已经加入 Git 暂存区的改动" },
  { id: "last-commit", label: "已提交", description: "最近一次提交带来的改动" },
  { id: "branch", label: "分支", description: "当前分支相对上游或主分支的改动" },
]

function scopeLabel(scope: ReviewScope): string {
  return SCOPES.find((candidate) => candidate.id === scope)?.label ?? "审核范围"
}

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

function ignoredOf(paths: readonly string[] | undefined): readonly string[] {
  return paths === undefined ? [] : paths
}

export function Review({ cwd, threadId, stamp, wanted, panelActive, panel, onClose, onCopy }: {
  cwd: string
  threadId: string
  /** 轮次戳：跑完一轮就重问一遍 git。 */
  stamp: string
  /** 引擎明确上报过的路径；Git 忽略项也必须诚实地出现在审核状态里。 */
  wanted: readonly string[]
  panelActive: boolean
  panel: PanelTabsProps
  onClose: () => void
  onCopy: (text: string) => Promise<boolean>
}): React.JSX.Element {
  const box = usePanelKeys(onClose, panelActive)
  const [scope, setScope] = useState<ReviewScope>("last-turn")
  const data = useReview(cwd, stamp, { threadId, wanted, scope })
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const [split, setSplit] = useState(false)
  const [context, setContext] = useState<number>(3)
  const [list, setList] = useState(true)
  const files = useMemo(() => filterFiles(data.files, query), [data.files, query])
  // 选中的那个被筛掉了（或者上一轮把它改回去了）就退回第一个——
  // 停在一个列表里已经没有的文件上，右边会一直是空的
  const active = files.some((f) => f.rel === picked) ? picked : files[0]?.rel
  const patch = usePatch(cwd, active, { context, stamp, threadId, revision: data.revision, scope })
  const { added, removed } = tallyReview(data.files)
  const total = data.files.length + (data.more ?? 0)
  const ignored = ignoredOf(data.ignored)
  const unverified = ignored.length
  const file = files.find((f) => f.rel === active)
  return (
    <section className="rv" ref={box} tabIndex={-1} aria-label="审核改动" hidden={!panelActive}>
      <PanelTabs {...panel} />
      <header className="rv__head">
        <Select label={scopeLabel(scope)} title="选择审核范围" sections={[{
          choices: SCOPES,
          value: scope,
          onPick: (id) => {
            const picked = SCOPES.find((candidate) => candidate.id === id)
            if (picked !== undefined) setScope(picked.id)
          },
        }]} />
        <div className="rv__summary">
          <ReviewSummary
            state={{ noRepo: data.noRepo, loading: data.loading, failed: data.failed,
              baseline: data.baseline, total, unverified, range: scopeLabel(scope),
              turnMissing: data.turnMissing,
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
            list={list}
            onList={setList}
            files={data.files}
            active={active}
            onPick={(rel) => { setQuery(""); setPicked(rel) }}
          />
      </header>
      <div className={`rv__body${list ? "" : " rv__body--list-hidden"}`}>
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
            range: scopeLabel(scope),
            turnMissing: data.turnMissing,
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
