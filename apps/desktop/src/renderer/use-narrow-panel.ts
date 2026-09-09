import { useEffect, useLayoutEffect, useState } from "react"

/**
 * **布局前就量。** `useEffect` 排在绘制之后，于是「补丁区其实放不下两列」这件事
 * 要等到第一帧画完才知道——并排按钮会先亮一下再灰掉，出图脚本也会拍到那一帧。
 * 服务端渲染没有布局可量（组件测试走 `renderToStaticMarkup`），那边退回 `useEffect`
 * 免得 React 报警。
 */
const useMeasure = typeof window === "undefined" ? useEffect : useLayoutEffect

/**
 * 面板窄到不能并排的那一档。
 *
 * ## 这个数怎么来的
 *
 * 每侧 210px，减去行号 3.6em ≈ 45px、记号列 1.4em ≈ 17.5px、右边距 12px，
 * 正文只剩约 135px ≈ **18 个字符**——已经到下限。
 * 而 `--workbench-w` 的下限是 300px（窗口窄到 1280 以下就一直是它），
 * 那一档下并排每侧只剩 14 个字符：`ReviewDiff.tsx` 开头那句「窄的时候不给并排」
 * 原来是句空话，父层根本没有这个判断。
 *
 * ⚠️ **`review.css` 的 `@container (max-width: 420px)` 用的是同一个数**
 *（那条管的是「单栏收掉旧行号列」）。改一处要改两处——它们说的是同一件事：
 * 这块补丁区窄到只够摆一列代码了。
 *
 * ⚠️ 量的是 **`.rv__pane`（补丁区）**，不是 `.rv`（整扇面板）：面板里还并排站着
 * 260px 的文件清单，`.rv` 有 540px 的时候补丁区只有 279px。拿面板宽当判据的话，
 * 「够宽」会在补丁区只剩每侧 130px 的时候就点头——而那正是这条闸门要挡的场景。
 */
export const SPLIT_MIN_W = 420

/**
 * 盯住补丁区的宽度，回答「现在还能不能并排」。
 *
 * **不改用户那颗开关的值**：窄了自动退回单栏，拉宽了自己回到并排，
 * 而不是让人再点一次。开关记的是「你想怎么看」，这里记的是「现在放不放得下」，
 * 两件事各存各的——把它们合成一个 state 的话，拉宽之后就回不去了。
 */
export function useNarrowPanel(box: React.RefObject<HTMLElement | null>, limit = SPLIT_MIN_W): boolean {
  const [narrow, setNarrow] = useState(false)
  useMeasure(() => {
    const el = box.current
    // jsdom 里没有 ResizeObserver；测试跑的是「宽的那一档」，和真机初值一致
    if (el === null || typeof ResizeObserver === "undefined") return undefined
    const measure = (): void => {
      setNarrow(el.getBoundingClientRect().width < limit)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [box, limit])
  return narrow
}
