import { useCallback, useEffect, useState } from "react"
import { droppedImages, pasteImages, pickedImages, type AttachmentResult } from "./attachment-actions.js"

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
  /** 最近一次没有收下的原因；成功后自动消失。 */
  notice?: string
  /** 处理一次粘贴。默认粘贴必须由调用方在异步落盘前同步拦住。 */
  paste: (items: DataTransferItemList | null) => Promise<void>
  /** 处理一次拖放。 */
  drop: (files: FileList | null) => void
  /** 打开系统图片选择器。 */
  pick: () => Promise<void>
  /** 用一组已经落盘的路径替换当前附件（取回队列 / 改一改再发）。 */
  replace: (paths: readonly string[]) => void
  remove: (path: string) => void
  clear: () => void
}

export function useAttachments(enabled: boolean): Attachments {
  const [paths, setPaths] = useState<readonly string[]>([])
  const [notice, setNotice] = useState<string>()
  const bridge = typeof window === "undefined" ? undefined : window.omni

  const accept = useCallback((result: AttachmentResult) => {
    if (result.paths.length > 0) {
      // 同一张图贴两次没有意义，而且会让模型多读一遍
      setPaths((prev) => [...new Set([...prev, ...result.paths])])
    }
    setNotice(result.notice)
  }, [])

  useEffect(() => {
    if (notice === undefined) return undefined
    const timer = window.setTimeout(() => { setNotice(undefined) }, 5000)
    return () => { window.clearTimeout(timer) }
  }, [notice])

  const paste = useCallback(async (items: DataTransferItemList | null): Promise<void> => {
    accept(await pasteImages(items, enabled, bridge))
  }, [accept, bridge, enabled])

  const drop = useCallback((files: FileList | null) => {
    accept(droppedImages(files, enabled, bridge))
  }, [accept, bridge, enabled])

  const pick = useCallback(async () => {
    accept(await pickedImages(bridge))
  }, [accept, bridge])

  return {
    paths,
    notice,
    paste,
    drop,
    pick,
    replace: useCallback((next: readonly string[]) => {
      setPaths([...new Set(next)])
      setNotice(undefined)
    }, []),
    remove: useCallback((path: string) => {
      setPaths((prev) => prev.filter((p) => p !== path))
    }, []),
    clear: useCallback(() => {
      setPaths([])
      setNotice(undefined)
    }, []),
  }
}
