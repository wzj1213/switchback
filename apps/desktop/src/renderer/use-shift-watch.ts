import { useEffect } from "react"

/**
 * 窗口刚回来那一下，界面有没有跳。
 *
 * ## 为什么值得常开一条
 *
 * 「从别的应用切回来，整个对话抖了一下」这类反馈**复现不出来就等于没有**：
 * 它取决于当时那条会话的内容、滚动位置、窗口尺寸，而这些在别人机器上凑不齐。
 * 实测过一轮——固定样本 + 真的 ⌘Tab 切走再切回，`layout-shift` 一次都没有。
 * 所以缺的不是分析，是**那一刻的现场**。
 *
 * 打包版没有 DevTools 入口，用户也没法粘一段脚本进控制台。那就让应用自己记：
 * 抖了就在日志里留一行，写明**是哪个元素、往哪个方向挪了多少**。
 * 日志的位置在设置 →「数据与排查」里指得到。
 *
 * ## 只记窗口回来之后那一秒半
 *
 * 全程记的话，流式输出会把日志刷爆——正文在长高，`layout-shift` 每一批都报，
 * 而那些位移是**对的**。只在 `focus` 之后开一小段窗口，恰好只覆盖
 * 「切回来那一下」这一种情形，其余时候这条完全静默。
 *
 * `PerformanceObserver` 本身是被动的：没有位移就没有回调，常开不花钱。
 */

/** 超过这个分数才算「看得见的一跳」。0.05 大约是一屏挪掉二十分之一。 */
const LOUD = 0.05
/** 窗口回来之后盯多久。 */
const WATCH_MS = 1500

interface ShiftSource {
  node?: Node | null
  previousRect: DOMRectReadOnly
  currentRect: DOMRectReadOnly
}

interface ShiftEntry extends PerformanceEntry {
  value: number
  hadRecentInput: boolean
  sources?: readonly ShiftSource[]
}

/** 元素的可读身份。**类名比 tag 有用得多**，而完整路径太长没人读。 */
function nameOf(node: Node | null | undefined): string {
  if (!(node instanceof Element)) return "?"
  const cls = node.className.toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".")
  return cls === "" ? node.tagName.toLowerCase() : `${node.tagName.toLowerCase()}.${cls}`
}

function describe(entry: ShiftEntry): string {
  const moved = (entry.sources ?? [])
    .slice(0, 3)
    .map((s) => {
      const dx = Math.round(s.currentRect.x - s.previousRect.x)
      const dy = Math.round(s.currentRect.y - s.previousRect.y)
      return `${nameOf(s.node)} Δ${String(dx)},${String(dy)}`
    })
    .join(" / ")
  // i18n-ok：开发用的控制台警告，不上界面
  return `窗口回来之后界面跳了一下（${entry.value.toFixed(3)}）：${moved === "" ? "没报出是谁" : moved}`
}

export function useShiftWatch(): void {
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return undefined
    let until = 0
    const observer = new PerformanceObserver((list) => {
      if (performance.now() > until) return
      for (const entry of list.getEntries() as ShiftEntry[]) {
        // 紧跟用户输入的那些位移是**他自己按出来的**，不算意外
        if (entry.hadRecentInput || entry.value < LOUD) continue
        // 渲染层没有别的出口：主进程只转发 `warn` / `error` 到日志文件
        //（见 `main/index.ts` 的 `console-message`），而这条诊断的全部价值
        // 就在于**进到用户拿得到的那份日志里**
        // eslint-disable-next-line no-console
        console.warn(describe(entry))
      }
    })
    try {
      observer.observe({ type: "layout-shift", buffered: false })
    } catch {
      // 这个类型在别的引擎里不存在。**不报错**：它是诊断，不是功能
      return undefined
    }
    const open = (): void => {
      until = performance.now() + WATCH_MS
    }
    window.addEventListener("focus", open)
    return () => {
      window.removeEventListener("focus", open)
      observer.disconnect()
    }
  }, [])
}
