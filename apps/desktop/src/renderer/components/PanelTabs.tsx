import { useRef, useState } from "react"
import type { PanelPage } from "../panel-state.js"
import { CompareIcon, PlusIcon } from "./icons.js"
import { DotBoxIcon, FileIcon } from "./icons-activity.js"
import { CloseIcon, ExpandIcon, PanelIcon } from "./icons-panel.js"
import { Popover } from "./Popover.js"

const PAGES: readonly { id: PanelPage; label: string; description: string }[] = [
  { id: "review", label: "审查", description: "查看工作区的真实 Git 差异" },
  { id: "files", label: "文件", description: "搜索并预览当前工作区文件" },
  { id: "activity", label: "活动", description: "查看引擎公开的后台任务与输出" },
]

function PageIcon({ page }: { page: PanelPage }): React.JSX.Element {
  if (page === "review") return <CompareIcon size={13} />
  if (page === "files") return <FileIcon size={13} />
  return <DotBoxIcon size={13} />
}

export interface PanelTabsProps {
  tabs: readonly PanelPage[]
  active: PanelPage
  full: boolean
  onSelect: (page: PanelPage) => void
  onClose: (page: PanelPage) => void
  onFull: () => void
  onHide: () => void
}

export function PanelTabs(props: PanelTabsProps): React.JSX.Element {
  const [menu, setMenu] = useState(false)
  const plus = useRef<HTMLButtonElement>(null)
  return (
    <header className="panel-tabs">
      <nav className="panel-tabs__list" aria-label="侧边面板页面">
        {props.tabs.map((page) => {
          const label = PAGES.find((candidate) => candidate.id === page)?.label ?? page
          const active = props.active === page
          return (
            <span className={`panel-tab${active ? " panel-tab--on" : ""}`} key={page}>
              <button type="button" className="panel-tab__pick" aria-current={active ? "page" : undefined}
                onClick={() => { props.onSelect(page) }}>
                <PageIcon page={page} /><span>{label}</span>
              </button>
              <button type="button" className="panel-tab__close" aria-label={`关闭${label}页`}
                onClick={() => { props.onClose(page) }}><CloseIcon size={13} /></button>
            </span>
          )
        })}
      </nav>
      <button ref={plus} type="button" className="panel-tabs__button" aria-label="新建侧边页面"
        title="新建侧边页面" aria-haspopup="menu" aria-expanded={menu}
        onClick={() => { setMenu((open) => !open) }}>
        <PlusIcon size={13} />
      </button>
      <Popover open={menu} anchor={plus.current} minWidth={220} onClose={() => { setMenu(false) }}>
        <div role="menu" aria-label="新建侧边页面">
          {PAGES.map((page) => (
            <button key={page.id} type="button" role="menuitem" className="pop__item"
              onClick={() => { setMenu(false); props.onSelect(page.id) }}>
              <PageIcon page={page.id} />
              <span className="pop__text"><span className="pop__label">{page.label}</span>
                <span className="pop__desc">{page.description}</span></span>
            </button>
          ))}
        </div>
      </Popover>
      <span className="panel-tabs__spacer" />
      <button type="button" className="panel-tabs__button panel-tabs__expand"
        aria-label={props.full ? "并排显示侧边面板" : "展开侧边面板"}
        title={props.full ? "并排显示侧边面板" : "展开侧边面板"} onClick={props.onFull}>
        <ExpandIcon />
      </button>
      <button type="button" className="panel-tabs__button" aria-label="隐藏侧边面板"
        title="隐藏侧边面板" onClick={props.onHide}>
        <PanelIcon />
      </button>
    </header>
  )
}
