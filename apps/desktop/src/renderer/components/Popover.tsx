import { useEffect, useLayoutEffect, useRef } from "react"
import { usePopoverLayout } from "./use-popover-layout.js"

/**
 * 浮层。所有下拉、菜单都长在它上面。
 *
 * ## 为什么不用原生 `<select>`
 *
 * 原生下拉的弹出层是**操作系统画的**，不是页面的一部分：
 *
 * - 样式改不了。字体、圆角、间距、选中态全都听系统的，
 *   于是它和周围每一个自绘控件都不一样——一屏里最刺眼的就是它。
 * - 结构撑不住。放不下「分组标题」「右侧当前值」「说明文字」这些，
 *   而模型选择器恰恰需要它们。
 * - 截图里看不见。自动化验证时弹出层根本不在窗口画面里，等于没法验。
 *
 * ## 三件必须做对的事
 *
 * 1. **点外面要关**，而且是 `pointerdown` 不是 `click`——用 `click` 的话，
 *    在别的按钮上按下时浮层还在，那个按钮会先被浮层挡住的元素吃掉一次事件。
 * 2. **Esc 要关**，并把焦点还给触发器。不还的话焦点掉到 body 上，
 *    键盘用户就此迷路。
 * 3. **超出窗口要翻边**。贴着屏幕底部的输入区往下弹，弹出去的部分
 *    看不见也点不到；所以默认往上弹，位置在挂载后按实际尺寸算。
 */

export interface PopoverProps {
  open: boolean
  onClose: () => void
  /** 触发器元素，用来定位与还焦点。 */
  anchor: HTMLElement | null
  /**
   * 定位到一个点（右键菜单）而不是贴着触发器。
   *
   * 给了这个就忽略 anchor 的几何，但**仍然用 anchor 还焦点**——
   * Esc 之后焦点要回到被右键的那一行，不能掉到 body 上。
   */
  at?: { x: number; y: number }
  children: React.ReactNode
  /** 面板最小宽度；不给就跟着内容。 */
  minWidth?: number
  /** 非菜单浮层必须给名字；有值时外壳按非模态 dialog 暴露。 */
  ariaLabel?: string
  /** 菜单真正换页时才换；普通父级重渲染不能借机把焦点拉回第一项。 */
  contentKey?: string | number
}

const MENU_ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'
const FOCUSABLE = `button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])`
const INITIAL_FOCUS = "[data-popover-autofocus]"

function menuItems(panel: HTMLElement): readonly HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(MENU_ITEM)].filter(
    (item) => !item.hasAttribute("disabled"),
  )
}

function focusPanel(panel: HTMLElement): void {
  const preferred = panel.querySelector<HTMLElement>(INITIAL_FOCUS)
  if (preferred !== null) {
    preferred.focus()
    return
  }
  const items = menuItems(panel)
  const selected = items.find((item) => item.getAttribute("aria-checked") === "true")
  ;(selected ?? items[0] ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus()
  selected?.scrollIntoView({ block: "nearest" })
}

function moveMenuFocus(panel: HTMLElement, key: string): boolean {
  const items = menuItems(panel)
  if (items.length === 0) return false
  const current = items.indexOf(document.activeElement as HTMLElement)
  const last = items.length - 1
  const next =
    key === "Home"
      ? 0
      : key === "End"
        ? last
        : key === "ArrowDown"
          ? (current + 1) % items.length
          : current <= 0
            ? last
            : current - 1
  items[next]?.focus()
  return true
}

export function Popover({
  open,
  onClose,
  anchor,
  at: point,
  children,
  minWidth,
  ariaLabel,
  contentKey,
}: PopoverProps): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null)
  const at = usePopoverLayout({ open, anchor, point, panel, contentKey })
  const placed = at !== undefined

  // 和位置一起在绘制前完成：菜单一旦可见，键盘落点也必须已经在里面。
  // 普通 effect 会留出一帧“菜单出现了、焦点还在旧控件”的竞态。
  useLayoutEffect(() => {
    if (!open || !placed || panel.current === null) return
    focusPanel(panel.current)
  }, [open, placed, contentKey])

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (panel.current?.contains(target ?? null) === true) return
      if (anchor?.contains(target ?? null) === true) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.isComposing) return
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        anchor?.focus()
        return
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
      if (panel.current === null || !panel.current.contains(event.target as Node | null)) return
      // 搜索框里的 Home / End 属于文本编辑；上下键才是进入结果列表。
      if (event.target instanceof HTMLInputElement && ["Home", "End"].includes(event.key)) return
      if (!moveMenuFocus(panel.current, event.key)) return
      event.preventDefault()
      event.stopPropagation()
    }
    // capture：浮层要在别人处理之前先决定关不关
    document.addEventListener("pointerdown", onPointer, true)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onPointer, true)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [open, anchor, onClose])

  if (!open) return null
  return (
    <div
      className="pop"
      ref={panel}
      /* 入场动效挂在这个属性上，**不挂在 `.pop` 上**：位置是挂载之后由
         `useLayoutEffect` 算出来的，在那之前面板是 `visibility: hidden`。
         挂在类上今天碰巧不出事，但哪天有人把它改成 `useEffect`，
         动画就在看不见的那一帧里跑完了——而且不报错 */
      data-placed={at === undefined ? "false" : "true"}
      {...(ariaLabel === undefined
        ? {}
        : { role: "dialog" as const, "aria-label": ariaLabel, tabIndex: -1 })}
      style={{
        // 位置没算出来之前先藏着，别让它在左上角闪一下
        visibility: at === undefined ? "hidden" : "visible",
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        ...(minWidth === undefined ? {} : { minWidth }),
      }}
    >
      {children}
    </div>
  )
}
