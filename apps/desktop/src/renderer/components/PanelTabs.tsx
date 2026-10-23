import type { PanelPage } from "../panel-state.js"
import { pressSelect } from "../press.js"
import { CompareIcon } from "./icons.js"
import { DotBoxIcon, FileIcon } from "./icons-activity.js"
import { CloseIcon, ExpandIcon } from "./icons-panel.js"
import { useMessages } from "../i18n.js"
import { PANEL_TABS } from "./PanelTabs.messages.js"

const PAGES: readonly PanelPage[] = ["review", "files", "activity"]

function PageIcon({ page }: { page: PanelPage }): React.JSX.Element {
  if (page === "review") return <CompareIcon size={14} />
  if (page === "files") return <FileIcon size={14} />
  return <DotBoxIcon size={14} />
}

export interface PanelTabsProps {
  active: PanelPage
  full: boolean
  onSelect: (page: PanelPage) => void
  onFull: () => void
  onHide?: () => void
}

/**
 * 侧边面板的页面切换。**三页固定常驻**：审查、文件、活动，一直都在这一排上。
 *
 * 上一版是浏览器式的页签——开过的页才显示、每页一颗 ×、「+」再从菜单里挑。
 * 面板默认只有两三百像素宽，于是这一排常年缩成「图标 × 图标 × +」，
 * 看不出哪颗是哪页；而页面总共就这三种，「新建」「关闭」两个动作本身就多余。
 * 照 VS Code 底部面板：固定几页常驻，右侧只留独占与收起。
 *
 * 页面第一次打开时才挂载，之后切走也保留（筛选词、选中位置都在）。
 * 审查页按 Esc 仍会关掉并重置自己（`usePanelKeys`），这一排上它照样在，点一下就回来。
 * 切换按下即生效（`press.ts`），说明文字进悬停提示。
 */
export function PanelTabs(props: PanelTabsProps): React.JSX.Element {
  const m = useMessages(PANEL_TABS)
  return (
    <header className="panel-tabs">
      <nav className="panel-tabs__list" aria-label={m.pages}>
        {PAGES.map((page) => {
          const active = props.active === page
          const pick = (): void => { props.onSelect(page) }
          return (
            <span className={`panel-tab${active ? " panel-tab--on" : ""}`} key={page}>
              <button type="button" className="panel-tab__pick" aria-current={active ? "page" : undefined}
                data-tip={m.about[page]} {...pressSelect(!active, pick)} onClick={pick}>
                <PageIcon page={page} /><span className="panel-tab__label">{m.label[page]}</span>
              </button>
            </span>
          )
        })}
      </nav>
      <span className="panel-tabs__spacer" />
      <button type="button" className="panel-tabs__button panel-tabs__expand"
        aria-label={props.full ? m.sideBySide : m.expand}
        data-tip={props.full ? m.sideBySide : m.expand} onClick={props.onFull}>
        <ExpandIcon />
      </button>
      {props.onHide === undefined ? null : (
        <button type="button" className="panel-tabs__button panel-tabs__hide"
          aria-label={m.hide} data-tip={m.hide} onClick={props.onHide}>
          <CloseIcon size={14} />
        </button>
      )}
    </header>
  )
}
