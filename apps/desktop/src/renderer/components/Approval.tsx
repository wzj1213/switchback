import { useEffect, useRef, useState } from "react"
import type { ApprovalItem, ItemId, RememberScope } from "@omni/protocol"

/** 用户对一张审批卡的裁决。 */
export type ResolveApproval = (itemId: ItemId, allow: boolean, remember: RememberScope) => void

/**
 * 焦点是不是正在某个输入框里。
 *
 * 快捷键**必须**先问这一句。用户正在输入框里打「拒绝这个方案的三个理由」，
 * 一个没有修饰键的 ⏎ 把审批批了，那是灾难。照 codex 的做法：
 * 正在打字就既不绑快捷键，也不抢焦点。
 */
function isTyping(): boolean {
  const el = document.activeElement
  if (el === null) return false
  return el.closest("input, textarea, [contenteditable]:not([contenteditable='false' i])") !== null
}

function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <kbd className="kbd">{children}</kbd>
}

/**
 * 审批卡。**整个产品最关键的界面**——上一版把它放在另一个页面（班组台），
 * 于是每个 Bash 都要跳出去批一次。这里它就在 transcript 里，原地处理。
 *
 * 形制参照 codex 桌面端的审批卡：
 *
 * - **三个范围是三个真按钮**，不是一个「不再询问」的勾选框。勾选框把
 *   「就这一次」「这轮对话都行」压成了一个布尔，用户没法表达中间那档。
 * - 主操作是**带下拉的分体按钮**：默认「允许一次」，下拉里放更宽的范围。
 *   最安全的那档占据最好按的位置。
 * - 正文可滚，**操作行在滚动区之外**（这条学 dsh）：命令再长也不能把按钮顶出屏幕。
 */
/** 当前持有 ⌘⏎ / ⌘⌫ 的那张卡。见下面 effect 里的说明。 */
const holder: { id: string | undefined } = { id: undefined }

export function Approval({
  item,
  onResolve,
}: {
  item: ApprovalItem
  onResolve: ResolveApproval
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const primary = useRef<HTMLButtonElement>(null)
  const settled = item.status !== "pending"

  /**
   * **快捷键只归最新那张卡。**
   *
   * 每张卡各自 `window.addEventListener` 的话，屏幕上挂着三张待批时按一下
   * ⌘⏎ 会**把三张一起批了**——而用户以为自己只批了眼前这一张。
   * 审批是这个产品里唯一「按错了就真出事」的地方，不能有这种歧义。
   *
   * 用一个模块级的持有者做互斥：后挂载的卡抢走持有权（它就是最新那张），
   * 卸载时只在自己还持有时才归还——否则会把后来者的持有权误清掉。
   */
  useEffect(() => {
    if (settled || isTyping()) return undefined
    holder.id = item.id
    primary.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || isTyping()) return
      // 不是持有者就装作没看见——同一次按键不该批掉屏幕上所有的卡
      if (holder.id !== item.id) return
      if (e.key === "Enter") {
        e.preventDefault()
        onResolve(item.id, true, "once")
      } else if (e.key === "Backspace") {
        e.preventDefault()
        onResolve(item.id, false, "once")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      if (holder.id === item.id) holder.id = undefined
    }
  }, [settled, item.id, onResolve])

  const decide = (allow: boolean, scope: RememberScope): void => {
    setOpen(false)
    onResolve(item.id, allow, scope)
  }

  return (
    <div className="approval">
      <div className="approval__body">
        <div className="approval__title">需要确认：{item.summary}</div>
        <div className="approval__detail">
          <span className="approval__label">原因</span>
          <span className="approval__reason">{item.reason}</span>
        </div>
      </div>
      <div className="approval__actions">
        {/* 「始终允许」只在判定器给得出可记忆规则时出现——给不出的时候
            摆一个按钮，用户点了却什么也没记住，比没有这个选项糟得多 */}
        {item.rememberHint === undefined || settled ? null : (
          <button
            className="btn approval__always"
            type="button"
            title={`以后在本工作区自动允许：${item.rememberHint}`}
            onClick={() => { decide(true, "project") }}
          >
            始终允许
          </button>
        )}
        <button className="btn" type="button" disabled={settled} onClick={() => { decide(false, "once") }}>
          {item.status === "denied" ? "已拒绝" : "拒绝"}
          {settled ? null : <Kbd>⌘⌫</Kbd>}
        </button>
        <div className="approval__split">
          <button
            ref={primary}
            className="btn btn--primary approval__split-main"
            type="button"
            disabled={settled}
            onClick={() => { decide(true, "once") }}
          >
            {item.status === "allowed" ? "已允许" : "允许一次"}
            {settled ? null : <Kbd>⌘⏎</Kbd>}
          </button>
          <button
            className="btn btn--primary approval__split-more"
            type="button"
            disabled={settled}
            aria-label="审批选项"
            aria-expanded={open}
            onClick={() => { setOpen((v) => !v) }}
          >
            ⌄
          </button>
          {open ? (
            <div className="menu">
              <button className="menu__item" type="button" onClick={() => { decide(true, "session") }}>
                允许此对话{item.rememberHint === undefined ? "" : `：${item.rememberHint}`}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
