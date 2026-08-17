import { useEffect } from "react"

/**
 * 滚动条：**平时看不见，滚动或悬停才淡进来。**
 *
 * ## 为什么之前的结论是「不做」，现在做了
 *
 * 上一轮审计的结论是不自绘，理由有三条，其中两条今天仍然成立：
 *
 * 1. mac 上只要写一条 `::-webkit-scrollbar` 规则，这个容器就从**叠加条**切到
 *    **经典条**——常驻、占宽度、没有系统的淡出。**这条是真的**，所以下面那套样式
 *    只在「系统本来就已经是经典条」的时候才挂（见 `barsOf`）：触控板档位一个字节都不动，
 *    系统那套白送的叠加条原样留着。
 * 2. 「自绘会永久让出 10px」——**在经典条档位下这句话反了**：系统那根实测 17px，
 *    自绘 10px，是**省下 7px**，而且它会淡出去。
 * 3. 「滑块参与不了动画系统，做不出淡出」——**这条是错的，实测推翻了。**
 *    直接给 `::-webkit-scrollbar-thumb` 写动画确实不生效（冻结在 50% 的红→蓝动画
 *    渲染出来还是纯红），但**把变量动在容器上、滑块只用 `var()` 读它**这条路生效：
 *    同样冻结在 50%，滑块渲染出来和写死 `.5` 的对照一模一样。
 *
 * 教训记在这儿：**「大概不行」和「量过不行」之间隔着一次三分钟的探针。**
 *
 * ## 两档各自的行为
 *
 * | 系统设置 | 今天 | 改完 |
 * | --- | --- | --- |
 * | 自动（触控板） | 叠加条：滚才现、会淡出、占 0px | **一模一样**（不挂任何样式） |
 * | 自动（插鼠标）/ 始终显示 | 经典条：常驻、17px、深灰 | 4px 细条、平时透明、滚动或悬停才淡进来 |
 */

/** 停手多久开始淡出。macOS 叠加条大约是 1 秒，这里跟着它。 */
const IDLE_MS = 900
/** 淡入淡出多久。比界面其他过渡慢一档：它是环境，不是反馈。 */
const FADE_MS = 320
const FADE = `--bar ${String(FADE_MS)}ms linear`

/**
 * 量出来的「滚动条占多宽」→ 现在是哪一档。
 *
 * **只能量，不能问**：CSS 和 JS 都没有「现在是叠加条还是经典条」这个查询，
 * 而这台机器上插不插鼠标随时会变（系统设置「自动根据鼠标或触控板」）。
 */
export function barsOf(gutter: number): "classic" | "overlay" {
  return gutter > 0 ? "classic" : "overlay"
}

/** 造一个不带任何自绘样式的探针，量它的滚动条占位。 */
function measure(doc: Document): number {
  const probe = doc.createElement("div")
  probe.style.cssText = "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll"
  doc.body.appendChild(probe)
  const gutter = probe.offsetWidth - probe.clientWidth
  probe.remove()
  return gutter
}

/**
 * 挂上去：给 `<html>` 标一个 `data-bars`，并在滚动时把滑块淡进来。
 *
 * ## 为什么只挂一个监听器
 *
 * 应用里有十几个滚动容器（转录区、侧栏、每个浮层、输入框、每块代码…），
 * 各挂各的既啰嗦又必然漏掉新加的那个。`scroll` 不冒泡，但**捕获阶段能收到全部**——
 * 一个监听器管所有容器，包括将来新增的。
 *
 * ## 为什么把变量写在元素上，而不是加个 class
 *
 * 加 class 要求每个滚动容器都记得写上那个 class（十几处，漏一个就有一根不会淡出的条）。
 * 直接把 `--bar` 写在**事件目标**上，谁滚谁亮，不需要任何一处配合。
 */
export function useScrollbars(): void {
  useEffect(() => {
    const root = document.documentElement
    const sync = (): void => {
      root.dataset["bars"] = barsOf(measure(document))
    }
    sync()
    // 插拔鼠标会让系统在两档之间切，而那没有事件可听——回到窗口时重量一次
    window.addEventListener("focus", sync)
    window.addEventListener("resize", sync)

    const timers = new WeakMap<HTMLElement, number>()
    const onScroll = (event: Event): void => {
      const el = event.target
      if (!(el instanceof HTMLElement) || root.dataset["bars"] !== "classic") return
      // 过渡写一次就够，而且**不会覆盖别人**：滚动容器里没有一个带 CSS 过渡的
      if (!el.style.transition.includes("--bar")) el.style.transition = FADE
      el.style.setProperty("--bar", "1")
      window.clearTimeout(timers.get(el))
      timers.set(
        el,
        window.setTimeout(() => {
          el.style.setProperty("--bar", "0")
        }, IDLE_MS),
      )
    }
    document.addEventListener("scroll", onScroll, true)
    return () => {
      window.removeEventListener("focus", sync)
      window.removeEventListener("resize", sync)
      document.removeEventListener("scroll", onScroll, true)
    }
  }, [])
}
