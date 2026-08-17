import { useEffect } from "react"

export interface MenuHandlers {
  newThread: () => void
  openFolder: () => void
  interrupt: () => void
  find: () => void
  copyMarkdown: () => void
  compare: () => void
  review: () => void
  filterThreads: () => void
  settings: () => void
}

/**
 * 把菜单发来的意图接到具体动作上。
 *
 * 菜单在主进程里，它不知道当前选中的是哪个会话，所以只发意图；
 * 「在哪个工作区新建」「中断哪一轮」这些只有渲染层知道。
 *
 * 依赖数组**故意只放 `deps`**：处理函数每次渲染都是新的，
 * 放进去会让订阅每帧重建一次。调用方把真正会变的东西（当前会话 id）传进来。
 */
export function useMenuActions(
  onMenu: (handler: (action: string) => void) => () => void,
  handlers: MenuHandlers,
  deps: readonly unknown[],
): void {
  const { newThread, openFolder, interrupt, find, copyMarkdown, compare, review, filterThreads, settings } = handlers
  useEffect(() => {
    const table: Readonly<Record<string, () => void>> = {
      "new-thread": newThread,
      "open-folder": openFolder,
      interrupt,
      find,
      "copy-markdown": copyMarkdown,
      compare,
      review,
      "filter-threads": filterThreads,
      settings,
    }
    return onMenu((action) => {
      table[action]?.()
    })
  }, [onMenu, ...deps])
}
