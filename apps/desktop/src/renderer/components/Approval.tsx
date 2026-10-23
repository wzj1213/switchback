import { useEffect, useRef, useState } from "react"
import type { ApprovalItem, ItemId, RememberScope } from "@switchback/protocol"
import { ShieldIcon } from "./icons.js"
import { useMessages } from "../i18n.js"
import { APPROVAL } from "./Approval.messages.js"

/** 用户对一张审批卡的裁决。 */
export type ResolveApproval = (
  itemId: ItemId,
  allow: boolean,
  remember: RememberScope,
  /** 「这一轮剩下的都别再问了」。不是记忆规则——轮次结束就没了。 */
  passTurn?: boolean,
) => void

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
/**
 * 「允许一次」旁边那个下拉里的两项。
 *
 * 「允许此对话」是**按模式**记的（记住的是这条规则），挡不住下一件不一样的事；
 * 而一轮里 agent 常常为八件各不相同的事各问一次——「本轮剩下的都放行」治的是那个。
 *
 * 副标题不是装饰：它说清两条边界（红线照问、下一轮恢复），
 * 否则用户会以为自己点了一个「永久全放行」，而那正是这个按钮**不是**的东西。
 */
function More({ hint, onPick }: {
  hint: string | undefined
  onPick: (allow: boolean, scope: RememberScope, passTurn?: boolean) => void
}): React.JSX.Element {
  const m = useMessages(APPROVAL)
  return (
    <div className="menu">
      <button className="menu__item" type="button" onClick={() => { onPick(true, "session") }}>
        {m.allowSession(hint)}
      </button>
      <button className="menu__item" type="button" onClick={() => { onPick(true, "once", true) }}>
        {m.passTurn}
        <span className="menu__note">{m.passTurnNote}</span>
      </button>
    </div>
  )
}

/**
 * 批完之后的那一行。
 *
 * ## 为什么终态不能继续长成一张卡
 *
 * 卡片的重量是给「**你现在要做个决定**」用的：带边框、带底色、带一颗近黑的主按钮。
 * 而批完之后它变成了**历史**——和它上下那些工具行是同一类东西（发生过的事），
 * 却比它们重一个数量级。一轮里批过三四次，整屏就成了一摞盒子加几团黑，
 * 而真正需要你看的那张待批卡混在里面反而不显眼了。
 *
 * 所以终态退回和 `.step` 一样的语言：一行、无边框、灰字、命令截断。
 * **「已拒绝」标红，「已允许」不标绿**——放行是常态，把常态染成彩色只是噪声；
 * 拒绝少见且值得一眼看到（这条和「可恢复的错误只给一行灰字」是同一把尺）。
 *
 * 拦下来的理由挂在 `title` 上：它在做决定时是主角，事后是脚注。
 */
function Settled({ item }: { item: ApprovalItem }): React.JSX.Element {
  const m = useMessages(APPROVAL)
  const denied = item.status === "denied"
  const verdict = item.status === "cancelled" ? m.expired : denied ? m.denied : m.allowed
  return (
    <div className="approval--done" title={item.reason}>
      <span className="approval__mark" aria-hidden="true">
        <ShieldIcon size={13} />
      </span>
      <span className={`approval__verdict${denied ? " approval__verdict--no" : ""}`}>
        {verdict}
      </span>
      <code className="approval__done-cmd">{item.summary}</code>
    </div>
  )
}

/** 进程或轮次已经不在时，旧 pending 只是一条历史，不能继续授予权限。 */
function Expired({ item }: { item: ApprovalItem }): React.JSX.Element {
  const m = useMessages(APPROVAL)
  return (
    <div className="approval--done" title={m.expiredTip}>
      <span className="approval__mark" aria-hidden="true"><ShieldIcon size={13} /></span>
      <span className="approval__verdict">{m.expired}</span>
      <code className="approval__done-cmd">{item.summary}</code>
    </div>
  )
}

/** 对比页是只读的；仍有效的请求要回到单栏处理，不能在两栏里误批错边。 */
function ReadOnly({ item }: { item: ApprovalItem }): React.JSX.Element {
  const m = useMessages(APPROVAL)
  return (
    <div className="approval--done" title={m.readOnlyTip}>
      <span className="approval__mark" aria-hidden="true"><ShieldIcon size={13} /></span>
      <span className="approval__verdict">{m.pending}</span>
      <code className="approval__done-cmd">{item.summary}</code>
    </div>
  )
}

export function Approval({
  item,
  onResolve,
  active,
  shortcut,
  readOnly,
}: {
  item: ApprovalItem
  onResolve: ResolveApproval
  /** 只有当前活跃轮次里的 pending 请求仍可裁决。 */
  active: boolean
  /** 当前轮次最新的 pending 卡；只有它响应全局快捷键和自动聚焦。 */
  shortcut: boolean
  /** 对比页只展示仍有效的请求，不在双栏里执行有副作用的裁决。 */
  readOnly: boolean
}): React.JSX.Element {
  const m = useMessages(APPROVAL)
  const [open, setOpen] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const settled = item.status !== "pending"

  /**
   * **快捷键只归最新那张卡。**
   *
   * 每张卡各自 `window.addEventListener` 的话，屏幕上挂着三张待批时按一下
   * ⌘⏎ 会**把三张一起批了**——而用户以为自己只批了眼前这一张。
   * 审批是这个产品里唯一「按错了就真出事」的地方，不能有这种歧义。
   *
   * `Transcript` 从有序 item 中直接选出最新一张，再通过 `shortcut` 指给它。
   * 仲裁因此是纯派生状态，不需要跨会话共享一个可变的模块级持有者。
   */
  useEffect(() => {
    if (settled || !active || !shortcut || readOnly) return undefined
    // **焦点给卡片本身，不给「允许一次」。** 给了按钮的话，人正在转录区里按空格翻页、
    // 或者刚点完别处按了回车，下一下就把这张卡批了——审批只认明确的 ⌘⏎ / ⌘⌫ 或点按钮
    if (!isTyping()) card.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent): void => {
      // 长按不算：按住 ⌘⏎ 的自动重复会把接着冒出来的下一张也批掉
      if (!(e.metaKey || e.ctrlKey) || e.repeat || isTyping()) return
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
    }
  }, [settled, active, shortcut, readOnly, item.id, onResolve])

  const decide = (allow: boolean, scope: RememberScope, passTurn?: boolean): void => {
    setOpen(false)
    onResolve(item.id, allow, scope, passTurn)
  }

  // 批完了就不再是一张卡。理由见 `Settled`
  if (settled) return <Settled item={item} />
  if (!active || readOnly) return active ? <ReadOnly item={item} /> : <Expired item={item} />

  return (
    <div className="approval" ref={card} tabIndex={-1} role="group" aria-label={m.confirmLabel(item.summary)}>
      <div className="approval__body">
        {/* 抬头只说「轮到你了」，一行小字。**要做的那件事不写在这里**——
            它是命令原文，值得自己一块地方（下面那块），混在标签后面会被读漏 */}
        <div className="approval__head">
          <span className="approval__mark" aria-hidden="true">
            <ShieldIcon size={13} />
          </span>
          {m.confirm}
        </div>
        {/* 命令原文走等宽、单独一块底色：**它是要被读准的东西**，比例字体下
            l/1/I 分不清；和界面文字挤在一行时，人会顺着句子读过去而不是逐字读它。
            同一条道理在工具行的路径、环境页的钩子命令上都写过一遍 */}
        <code className="approval__cmd">{item.summary}</code>
        <div className="approval__reason">{item.reason}</div>
      </div>
      <div className="approval__actions">
        {/* 「始终允许」只在这一条审批明确提供持久化语义时出现：可能是 Switchback
            的可记忆规则，也可能是引擎自己的原生授权（例如 Computer Use）。 */}
        {item.rememberHint === undefined || settled ? null : (
          <button
            className="btn approval__always"
            type="button"
            title={m.alwaysTip(item.rememberHint)}
            onClick={() => { decide(true, "project") }}
          >
            {m.always}
          </button>
        )}
        <button className="btn" type="button" disabled={settled} onClick={() => { decide(false, "once") }}>
          {item.status === "denied" ? m.denied : m.deny}
          {settled ? null : <Kbd>⌘⌫</Kbd>}
        </button>
        <div className="approval__split">
          <button
            className="btn btn--primary approval__split-main"
            type="button"
            disabled={settled}
            onClick={() => { decide(true, "once") }}
          >
            {item.status === "allowed" ? m.allowed : m.once}
            {settled ? null : <Kbd>⌘⏎</Kbd>}
          </button>
          <button
            className="btn btn--primary approval__split-more"
            type="button"
            disabled={settled}
            aria-label={m.options}
            aria-expanded={open}
            onClick={() => { setOpen((v) => !v) }}
          >
            ⌄
          </button>
          {open ? <More hint={item.rememberHint} onPick={decide} /> : null}
        </div>
      </div>
    </div>
  )
}
