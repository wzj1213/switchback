import { Thumb } from "./ImageThumb.js"

/**
 * 输入框上方那排待发附件。
 *
 * **必须显示出来。** 贴完图什么都不变的话，人不知道它收没收到——
 * 而这件事出错的方式恰好是「静默地没收到」，跑完一轮才发现模型压根没看见图。
 *
 * ## 为什么是缩略图而不是文件名
 *
 * 上一版画的是「图标 + `20260816-104233-8812.png`」。那串名字是**落盘时
 * 自动生成的**，和图的内容没有任何关系——贴三张截图排出来就是三行几乎一样的
 * 时间戳，你分不出哪张是哪张，也就没法确认「要发的是不是我想发的那张」。
 *
 * 而这排东西存在的全部理由就是让人确认这件事。所以画图本身。
 */
export function Attachments({
  paths,
  onRemove,
}: {
  paths: readonly string[]
  onRemove: (path: string) => void
}): React.JSX.Element | null {
  if (paths.length === 0) return null
  return (
    <div className="attach">
      {paths.map((path) => (
        <Thumb key={path} path={path} onRemove={onRemove} />
      ))}
    </div>
  )
}
