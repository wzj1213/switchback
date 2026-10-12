import { useState } from "react"
import type { EngineInfo, UserMessageItem } from "@switchback/protocol"
import type { EngineStint } from "../engine-mark.js"
import { engineTint } from "../engine-mark.js"
import { labelOf } from "./Composer.js"
import { ChevronIcon } from "./icons.js"
import { LinkifiedText } from "./linkified-text.js"

/**
 * 转录区里那条「切换至 X」。
 *
 * ## 它只是一条分界，不是一条消息
 *
 * 靠左、靠右、带头像的都不行——那三种长得像「有人说了句话」，而这里
 * 没有人说话：`Thread.segments` 记下了谁在什么时候接的手，这条线只是把
 * 那个时刻画出来。所以形制照轮次分界线（`.turnmark`）：一道细线穿过整幅，
 * 中间嵌一枚小牌子。**同一种视觉语言说同一类事**——「这里是个接缝」。
 *
 * 牌子上那颗点用这家引擎的颜色，和左缘导航是同一套色（`engineTint`）：
 * 往回翻的时候，导航上那一段的颜色和这条线上的颜色对得上，
 * 才能把「哪几问是它答的」连成一句话。
 */
export function EngineSwitchMark({
  stint,
  engines,
  brief,
}: {
  stint: EngineStint
  /** 引擎清单：把 id 翻成人话。找不到就退回原 id，不编一个名字。 */
  engines: readonly EngineInfo[]
  /** 换家时随第一句发过去的交接说明（`withHandoffBriefs` 收进来的）。默认收起，点开是原文。 */
  brief?: UserMessageItem | undefined
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const label = labelOf(engines, stint.engine)
  const name = stint.profile === undefined ? label : `${label} · ${stint.profile}`
  return (
    <div className="handmark-wrap">
      <div className="handmark" role={brief === undefined ? "separator" : undefined} aria-label={`切换至 ${name}`}>
        <span className="handmark__tag">
          <i className="handmark__dot" style={{ background: engineTint(stint.engine) }} aria-hidden="true" />
          切换至 {name}
          {brief === undefined ? null : (
            <button
              type="button"
              className="handmark__brief"
              aria-expanded={open}
              onClick={() => {
                setOpen((was) => !was)
              }}
            >
              · 附交接说明
              <ChevronIcon open={open} size={12} />
            </button>
          )}
        </span>
      </div>
      {brief !== undefined && open ? (
        <div className="handmark__text">
          <LinkifiedText text={brief.text} />
        </div>
      ) : null}
    </div>
  )
}
