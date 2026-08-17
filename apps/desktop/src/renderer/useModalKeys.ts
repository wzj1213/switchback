import { useEffect, useRef } from "react"

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
 * ## 不做焦点陷阱
 *
 * Tab 仍然会走出面板。做陷阱要接管一整套焦点顺序，而这个面板背后是个静止的界面，
 * 走出去的代价远小于一套自己维护的焦点环——真需要时单独做，不夹在这里。
 */
export function useModalKeys(onClose: () => void): React.RefObject<HTMLDivElement | null> {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 打开就把焦点收进来：不收的话焦点还留在触发它的那颗按钮上，
    // Esc 之外的键（Tab）会从界面另一头开始走
    box.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])
  return box
}
