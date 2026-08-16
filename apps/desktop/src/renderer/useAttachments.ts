import { useCallback, useState } from "react"

/**
 * 输入区的附件：贴进来、拖进来、去掉。
 *
 * ## 只收图片
 *
 * 拖一个 `.zip` 进来送给模型没有意义——它读不了，而界面上却显示「已附上」，
 * 那是骗人。认不出的类型**当场就不收**，而不是收下之后由引擎报错。
 *
 * ## 为什么存路径不存字节
 *
 * 见 `main/attach.ts`：两家引擎都更喜欢路径，而且落了盘的图**事后还能打开**
 * ——会话记录里那句「看看这个报错」配的是哪张图，三天后还查得到。
 */
export interface Attachments {
  paths: readonly string[]
  /** 处理一次粘贴。返回 true 表示确实收了图（调用方据此 `preventDefault`）。 */
  paste: (items: DataTransferItemList | null) => Promise<boolean>
  /** 处理一次拖放。 */
  drop: (files: FileList | null) => void
  remove: (path: string) => void
  clear: () => void
}

export function useAttachments(enabled: boolean): Attachments {
  const [paths, setPaths] = useState<readonly string[]>([])
  const bridge = typeof window === "undefined" ? undefined : window.omni

  const add = useCallback((path: string | undefined) => {
    if (path === undefined) return
    // 同一张图贴两次没有意义，而且会让模型多读一遍
    setPaths((prev) => (prev.includes(path) ? prev : [...prev, path]))
  }, [])

  const paste = useCallback(
    async (items: DataTransferItemList | null): Promise<boolean> => {
      if (!enabled || items === null || bridge === undefined) return false
      let took = false
      for (const item of Array.from(items)) {
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue
        const file = item.getAsFile()
        if (file === null) continue
        took = true
        add(await bridge.stashImage(file.type, await file.arrayBuffer()))
      }
      return took
    },
    [enabled, bridge, add],
  )

  const drop = useCallback(
    (files: FileList | null) => {
      if (!enabled || files === null) return
      for (const file of Array.from(files)) {
        // 拖进来的文件在 Electron 里带真实路径，不用再落一次盘
        const path = (file as File & { path?: string }).path
        if (typeof path === "string" && path !== "") add(path)
      }
    },
    [enabled, add],
  )

  return {
    paths,
    paste,
    drop,
    remove: useCallback((path: string) => {
      setPaths((prev) => prev.filter((p) => p !== path))
    }, []),
    clear: useCallback(() => {
      setPaths([])
    }, []),
  }
}
