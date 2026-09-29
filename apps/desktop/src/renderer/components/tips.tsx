import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { tipSpot, type TipBox } from "../tips.js"

/**
 * 悬停提示。**一层，不是每颗按钮各挂一个。**
 *
 * ## 为什么不用系统的 `title`
 *
 * 只有图标的按钮必须能说出自己是干什么的，而 `title` 那条路有三个毛病：
 *
 * 1. **慢**。系统要等一秒多才弹，而人在一排图标上扫过去是几百毫秒的事——
 *    等它弹出来的时候，指针已经在下一颗上了。
 * 2. **长得不像这个应用**。它是系统画的小黄条（深色模式下也不跟着变），
 *    和这一屏每一个自绘控件都不一样。
 * 3. **拍不到**。自动化出图时它根本不在窗口画面里，等于没法验。
 *
 * ## 为什么是一层而不是每颗按钮自己带
 *
 * 界面上有二十七颗只有图标的按钮。每颗各挂一份状态和一个浮层，就是二十七份
 * 几乎一样的代码，而且它们**同时最多只有一个可见**——那是典型的该收成一层的东西。
 * 按钮那边只留一个 `data-tip="…"`，其余全在这里。
 *
 * 事件用**捕获期的 `pointerover`/`pointerout`**（冒泡到 document）：
 * 按钮可能在浮层里、在滚动容器里、在刚挂上来的树里，逐个挂监听会漏。
 */

/** 停多久才弹。比系统快一档：扫过一排图标时不该每一颗都弹。 */
const DELAY = 380

export function TipLayer(): React.JSX.Element | null {
  const [tip, setTip] = useState<
    { text: string; box: TipBox; size?: { width: number; height: number } } | undefined
  >(undefined)
  const plate = useRef<HTMLSpanElement>(null)
  // 先按估的大小画一次、量出真宽高、再按真值摆——都在绘制之前，屏幕上只有最后那一帧
  useLayoutEffect(() => {
    const el = plate.current
    if (el === null || tip === undefined || tip.size !== undefined) return
    setTip({ ...tip, size: { width: el.offsetWidth, height: el.offsetHeight } })
  }, [tip])
  useEffect(() => {
    let timer = 0
    const clear = (): void => {
      window.clearTimeout(timer)
      timer = 0
      setTip(undefined)
    }
    const over = (event: PointerEvent): void => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-tip]")
      const text = target?.dataset["tip"]
      if (target === null || target === undefined || text === undefined || text === "") {
        clear()
        return
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const rect = target.getBoundingClientRect()
        setTip({ text, box: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } })
      }, DELAY)
    }
    document.addEventListener("pointerover", over, true)
    document.addEventListener("pointerout", clear, true)
    // 一按下去就收：那一刻你已经知道它是干什么的了，留着只会挡住结果
    document.addEventListener("pointerdown", clear, true)
    // 滚动/换窗口即收：浮层是按当时的坐标摆的，留着就是指着一个已经挪走的东西
    window.addEventListener("scroll", clear, true)
    window.addEventListener("blur", clear)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("pointerover", over, true)
      document.removeEventListener("pointerout", clear, true)
      document.removeEventListener("pointerdown", clear, true)
      window.removeEventListener("scroll", clear, true)
      window.removeEventListener("blur", clear)
    }
  }, [])
  if (tip === undefined) return null
  const at = tipSpot(tip.box, { width: window.innerWidth, height: window.innerHeight }, tip.size)
  return (
    <span ref={plate} className="tip" style={{ left: at.left, top: at.top }} data-side={at.side} role="tooltip">
      {tip.text}
    </span>
  )
}
