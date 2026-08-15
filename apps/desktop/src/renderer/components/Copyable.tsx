import { useState, type ReactNode } from "react"
import type { Item } from "@omni/protocol"
import { textOf } from "../export.js"

/** 复制成功后的提示时长。够看见，又不至于让人等它消失。 */
const FLASH_MS = 1200

/**
 * 给一条消息挂一个悬停才出现的复制按钮。
 *
 * 审批卡不挂——那上面有需要点的按钮，再放一个只会误点。
 */
export function Copyable({
  item,
  onCopy,
  children,
}: {
  item: Item
  onCopy: (text: string) => void
  children: ReactNode
}): React.JSX.Element {
  const [done, setDone] = useState(false)
  if (item.kind === "approval") return <>{children}</>
  return (
    <div className="copyable">
      {children}
      <button
        className="copyable__btn"
        type="button"
        aria-label="复制"
        title="复制这条内容"
        onClick={() => {
          onCopy(textOf(item))
          setDone(true)
          setTimeout(() => {
            setDone(false)
          }, FLASH_MS)
        }}
      >
        {done ? "已复制" : "复制"}
      </button>
    </div>
  )
}
