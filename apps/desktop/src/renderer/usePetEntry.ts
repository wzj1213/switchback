import { useEffect, useState } from "react"
import type { EngineId } from "@omni/protocol"
import { ENTRY_MS, entryOf, type EntryKind } from "./pet-entry.js"
import type { PetLook } from "./pets.js"

/**
 * 什么时候播登场。
 *
 * ## 触发的是「当前那家变了」，不是「重渲染了」
 *
 * 依赖里只有引擎 id：清单变化、模型换档、跑没跑完，都不该重播一次登场。
 * 一个每隔几秒重放的出场动画会立刻从「刚才变了」退化成背景噪音，
 * 而那正是 `Pets.tsx` 开头那段说过的事——一刻不停的动画持续抢注意力。
 *
 * ## 为什么用一个定时器而不是 `animationend`
 *
 * 一次登场同时在三个元素上跑（身子、道具、透明度），`animationend` 会来好几发，
 * 而且**动画被跳过时一发都不来**（元素还没进 DOM、标签页在后台、
 * 系统减少动效）。定时器的语义是「这一拍到此为止」，与有没有真的画出来无关——
 * 而下游要的恰恰是这个：登场没结束，那只就不算站定。
 */
export function usePetEntry(
  engine: EngineId,
  look: PetLook,
  on: boolean,
): EntryKind | undefined {
  const [entry, setEntry] = useState<EntryKind | undefined>(undefined)
  const kind = entryOf(look)
  useEffect(() => {
    if (!on) {
      setEntry(undefined)
      return
    }
    setEntry(kind)
    const timer = setTimeout(() => {
      setEntry(undefined)
    }, ENTRY_MS[kind])
    return () => {
      clearTimeout(timer)
    }
    // 依赖里**只有引擎和开关**：`look` 是每次渲染新造的对象，
    // 列进去等于每渲染一次重播一遍登场
  }, [engine, on])
  return entry
}
