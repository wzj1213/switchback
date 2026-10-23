import { useEffect, useState } from "react"
import type { Locale } from "@switchback/i18n"
import { WORKSITE } from "./useWorksite.messages.js"

/**
 * 「这条会话所在的工作区此刻是什么样」——分支、游离与否、脏不脏。
 *
 * ## 为什么抽成 hook
 *
 * `Chips` 和 `EnvCard` 此前各抄了一份同样的 `useEffect`。两份的后果不是重复代码，
 * 是**两份会分头走偏**：焦点刷新只加在其中一处，界面上就出现「输入框上面那枚变了、
 * 环境卡里那枚没变」——两个控件对同一件事给出两个答案，比都不刷新更难查。
 *
 * ## 三条取数时机，每一条都对应一种「它在说假话」
 *
 * 1. **cwd / stamp 变**：切会话、一轮开始、一轮结束。引擎跑完一轮，磁盘上就不是
 *    原来那样了（`stampOf` 的注释解释了为什么用轮次节拍而不是定时器）。
 * 2. **窗口重新获得焦点**：你要去终端里 `git switch`，**必然离开 Switchback 又回到 Switchback**。
 *    这一条覆盖「用户自己在别处改了工作区」的全部情况，而且不需要任何 watcher——
 *    全仓库零 watcher 是有意的（见 `packages/worksite/README.md`）。
 * 3. **Switchback 自己刚动过它**（审查页里暂存、提交）：那一下不离开窗口，焦点事件不会来，
 *    由动手的那一方发 `announceWorksiteChanged()`。
 * 没有第四条。别加定时器：问得勤就是每次 spawn 一个 git，问得懒就是界面说假话。
 *
 * ## 换工作区要清掉旧值，同一个工作区重问则不清
 *
 * 这两种情况必须分开。切到另一条会话时，上一个工作区的分支名**说的是别的地方的事**，
 * 留着它就是在骗人——所以清空，短暂地什么都不显示。
 * 而同一个 cwd 只是到了重问的节拍（一轮结束、窗口回来），旧值大概率仍然成立，
 * 清空只会让芯片闪一下。
 *
 * 一律清会闪，一律不清会说谎；判据就是 cwd 变没变。
 */

export interface Worksite {
  /** 分支名。**游离时这里是短 sha**，配合 `detached` 一起读。 */
  branch?: string
  /** HEAD 没指向任何分支（`git checkout <sha>` 之后）。 */
  detached?: boolean
  dirty?: boolean
  /** 未提交的文件数（准确值）。芯片上要截断显示，见 `dirtyMark`。 */
  dirtyCount?: number
}

const CHANGED = "switchback:worksite-changed"

/** Switchback 自己刚改过工作区的 Git 状态（暂存、提交）：让分支芯片与环境卡重问一次。 */
export function announceWorksiteChanged(): void {
  window.dispatchEvent(new Event(CHANGED))
}

export function useWorksite(threadId: string, cwd: string, stamp: string): Worksite {
  const [site, setSite] = useState<Worksite>({})
  // 焦点回来时 +1，进而触发下面那个 effect 重问一次
  const [visit, setVisit] = useState(0)
  const bridge = typeof window === "undefined" ? undefined : window.switchback

  useEffect(() => {
    if (typeof window === "undefined") return undefined
    const bump = (): void => {
      setVisit((n) => n + 1)
    }
    window.addEventListener("focus", bump)
    window.addEventListener(CHANGED, bump)
    return () => {
      window.removeEventListener("focus", bump)
      window.removeEventListener(CHANGED, bump)
    }
  }, [])

  // 换了工作区就先清空——旧值说的是别的地方的事。同一个 cwd 重问时不清
  useEffect(() => {
    setSite({})
  }, [cwd])

  useEffect(() => {
    if (bridge === undefined) return undefined
    let live = true
    // 切走之后才回来的那次响应不能再往界面上写：那时显示的已经是另一个工作区了
    void bridge.worksite(threadId, cwd).then((info) => {
      if (live) setSite(info)
    })
    return () => {
      live = false
    }
  }, [bridge, cwd, stamp, threadId, visit])

  return site
}

/**
 * 分支芯片上显示什么。游离时**不显示成一个叫 `HEAD` 的分支**——
 * 那是 `rev-parse --abbrev-ref` 的字面输出，纯属编造（见 `main/worksite.ts`）。
 */
export function branchLabel(site: Worksite, locale: Locale): string | undefined {
  if (site.branch === undefined || site.branch === "") return undefined
  return site.detached === true ? WORKSITE[locale].detached(site.branch) : site.branch
}

/**
 * 芯片上跟在分支后面那一小截。**说数量，不只说「有」。**
 *
 * 一个点说不出「三个文件没提交」和「三百个」的区别，而这两种情况下
 * 你该不该让引擎接着在上面动手，答案是不一样的。
 *
 * **截到 `999+`**：一个没 gitignore 的 `node_modules` 能让这个数上万，
 * 而芯片是输入框上方那条窄带——五位数会把分支名挤出去。
 * 准确值在环境卡里给（那儿有地方），芯片只负责让你察觉到「多得不正常」。
 */
export function dirtyMark(site: Worksite): string {
  const n = site.dirtyCount
  if (n === undefined) return site.dirty === true ? " ·" : ""
  if (n === 0) return ""
  return n > 999 ? " · 999+" : ` · ${String(n)}`
}
