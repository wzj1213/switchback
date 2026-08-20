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
    (node) => node.getAttribute("aria-hidden") !== "true" && !node.hasAttribute("inert"),
  )
}

function trapTab(event: KeyboardEvent, box: HTMLElement): void {
  if (event.key !== "Tab") return
  const nodes = focusable(box)
  if (nodes.length === 0) {
    event.preventDefault()
    box.focus()
    return
  }
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || !box.contains(active))) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first?.focus()
  }
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
export function useModalKeys(onClose: () => void): React.RefObject<HTMLDivElement | null> {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const origin =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    box.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      const current = box.current
      if (current === null) return
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
