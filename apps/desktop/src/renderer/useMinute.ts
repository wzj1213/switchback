import { useEffect, useState } from "react"

/**
 * 现在几点，每分钟变一次。侧栏那一列相对时间靠它自己老去。
 *
 * ## 为什么对齐到整分，而不是「挂载后每 60 秒」
 *
 * 侧栏常态二三十行，每行各起一个定时器。如果各自从挂载那一刻起算，
 * 它们会在一分钟里的**不同时刻**醒——这一行刚变成「4 分钟前」，隔壁那行
 * 还写着「3 分钟前」，十几秒后才轮到它。那一列于是零零碎碎地跳。
 *
 * 对齐到墙钟的整分之后，所有行**在同一时刻醒**，整列一起变。
 * 这样也就不需要一个模块级的共享定时器（那是本仓库明令禁止的模块级状态，
 * 见 eslint.config.js 那条 `no-restricted-syntax`）——各行各算各的，
 * 结果却是同步的。
 *
 * 多等 20ms 是给系统定时器的抖动留的余量：早醒哪怕 1ms，算出来的还是上一分钟。
 */
export function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = (): void => {
      timer = setTimeout(
        () => {
          setNow(Date.now())
          schedule()
        },
        60_000 - (Date.now() % 60_000) + 20,
      )
    }
    schedule()
    return () => {
      clearTimeout(timer)
    }
  }, [])
  return now
}
