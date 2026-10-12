import { RailIcon } from "./icons-panel.js"

/**
 * 侧栏开关。
 *
 * **它跟着侧栏走**：侧栏开着时在侧栏顶带的右端（`SidebarHead`），收起之后
 * 落进会话顶栏、紧挨着交通灯（`TopBar`）——永远在「它管的那一列」的边上，
 * 和 claude、codex、VS Code 三家同一个位置。拆成单独一个文件，是因为两处都要它。
 */
export function RailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className={`iconbtn${open ? "" : " iconbtn--on"}`}
      data-tip={open ? "收起侧栏（⌘\\）" : "展开侧栏（⌘\\）"}
      aria-label={open ? "收起侧栏" : "展开侧栏"}
      aria-pressed={!open}
      onClick={onToggle}
    >
      <RailIcon size={14} className={`rail-icon${open ? "" : " rail-icon--closed"}`} />
    </button>
  )
}
