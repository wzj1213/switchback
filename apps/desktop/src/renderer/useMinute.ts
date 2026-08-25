import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

/**
 * 现在几点，每分钟变一次。侧栏那一列相对时间靠它自己老去。
 *
 * ## 为什么对齐到整分，而不是「挂载后每 60 秒」
 *
 * 侧栏常态二三十行，**整列只起一个定时器**。每行各起一个不仅多出几十个
 * timer，窗口从后台恢复时还会同时灌回几十个回调；Provider 更新 context，
 * React 只重绘真正读取分钟值的那几段 `Since`。
 *
 * 对齐到墙钟的整分之后，所有行**在同一时刻醒**，整列一起变。
 * 这样也就不需要一个模块级的共享定时器（那是本仓库明令禁止的模块级状态，
 * 见 eslint.config.js 那条 `no-restricted-syntax`）——各行各算各的，
 * 结果却是同步的。
 *
 * 多等 20ms 是给系统定时器的抖动留的余量：早醒哪怕 1ms，算出来的还是上一分钟。
 */
const MinuteContext = createContext<number | undefined>(undefined)

/** 下一次整分之后 20ms。导出给边界测试，时钟仍由调用处传入。 */
export function minuteDelay(now: number): number {
  return 60_000 - (now % 60_000) + 20
}

export function MinuteProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = (): void => {
      timer = setTimeout(() => {
        setNow(Date.now())
        schedule()
      }, minuteDelay(Date.now()))
    }
    schedule()
    return () => {
      clearTimeout(timer)
    }
  }, [])
  return createElement(MinuteContext.Provider, { value: now }, children)
}

/** 只读 Provider 的共享分钟；孤立渲染（测试/故事）退回当下，不另起 timer。 */
export function useMinute(): number {
  return useContext(MinuteContext) ?? Date.now()
}
