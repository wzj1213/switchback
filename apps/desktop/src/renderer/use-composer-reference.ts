import { useEffect, useState } from "react"
import type { ComposerFileReference } from "./file-references.js"
import { onComposerReference } from "./composer-reference-request.js"

/**
 * 「把这条路径填进输入框」的那份状态。
 *
 * 两个来源，进的是同一个格子：**文件工作台点「引用」**走 props（那条链本来就在），
 * **斜杠命令 `/承接上一段` 与 ⇧⌘E** 走窗口事件——它们的发起点分散在
 * `Workspace` 与菜单接线两处，穿一条 props 链过去要经过四层。
 *
 * 带 `threadId`：请求可能在你已经切走之后才到，那时它该落在**发起的那条**上，
 * 不是你眼前这条（输入框那边按 `at` 判「这是不是新的一次要求」）。
 */
type Slot = ComposerFileReference & { threadId: string }

export function useComposerReference(): {
  reference: Slot | undefined
  set: React.Dispatch<React.SetStateAction<Slot | undefined>>
} {
  const [reference, set] = useState<Slot | undefined>()
  useEffect(
    () =>
      onComposerReference((detail) => {
        // `at` 自增而不是取时钟：同一毫秒内连按两次也得是两次不同的要求
        set((before) => ({ threadId: detail.threadId, path: detail.path, at: (before?.at ?? 0) + 1 }))
      }),
    [],
  )
  return { reference, set }
}
