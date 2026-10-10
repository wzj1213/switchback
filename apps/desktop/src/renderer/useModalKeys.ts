import { useEffect, useRef } from "react"

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

function focusable(box: HTMLElement): readonly HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.closest('[hidden], [inert], [aria-hidden="true"]') === null,
  )
}

/** 当前焦点在第几项；-1 代表容器本身或意外跑出模态。 */
export function tabDestination(active: number, total: number, backwards: boolean): number | undefined {
  if (total === 0) return undefined
  if (active < 0) return backwards ? total - 1 : 0
  if (backwards && active === 0) return total - 1
  if (!backwards && active === total - 1) return 0
  return undefined
}

/** 把 Tab 留在指定面板内；当前焦点意外跑出去时也会收回。 */
export function trapTab(event: KeyboardEvent, box: HTMLElement): void {
  if (event.key !== "Tab") return
  const nodes = focusable(box)
  if (nodes.length === 0) {
    event.preventDefault()
    box.focus()
    return
  }
  const active = document.activeElement
  const contained = active instanceof Node && box.contains(active)
  const at = contained && active !== box ? nodes.indexOf(active as HTMLElement) : -1
  const destination = tabDestination(at, nodes.length, event.shiftKey)
  if (destination === undefined) return
  event.preventDefault()
  nodes[destination]?.focus()
}

/**
 * 模态的键盘契约：**Esc 关掉，打开时焦点落进来**。
 *
 * ## 为什么单独一个文件
 *
 * 一是行数闸门（`SettingsPanel` 已经贴着 100 行的函数上限，内联写 effect 直接红）；
 * 二是这条契约本来就不属于某一个面板——下一个模态照样要它，而两份实现迟早分岔。
 *
 * ## 为什么挂**冒泡**阶段，不是捕获
 *
 * 实测派发顺序是 `window-捕获 → document-捕获 → window-冒泡`。浮层（`Popover`）
 * 的 Esc 挂在 document 的捕获阶段——这里若也用捕获，window 在外面先收到，
 * **设置面板会抢在里层浮层之前把自己关掉**：你想关的是刚点开的那个下拉。
 * 「谁先注册谁先收到」只在同一个节点上成立。
 *
 * `aria-modal` 的行为也在这里兑现：Tab 留在面板里，卸载时焦点回到触发器。
 */
export function useModalKeys(
  onClose: () => void,
  focusFirst = false,
): React.RefObject<HTMLDivElement | null> {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  const first = useRef(focusFirst)
  close.current = onClose
  useEffect(() => {
    const origin =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const current = box.current
    const initial = current === null || !first.current ? current : focusable(current)[0] ?? current
    initial?.focus()
    const onKey = (event: KeyboardEvent): void => {
      const current = box.current
      // 输入法组字时的 Esc 是取消组字（改名框里打中文最常见），不是关对话框
      if (current === null || event.isComposing) return
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        close.current()
        return
      }
      trapTab(event, current)
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      if (origin?.isConnected === true) origin.focus()
    }
  }, [])
  return box
}
