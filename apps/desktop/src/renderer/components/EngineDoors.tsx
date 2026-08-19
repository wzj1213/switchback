import { useEffect, useState } from "react"
import type { EngineDoor } from "../../main/enginedoors.js"
import { RevealIcon } from "./icons.js"

/**
 * 各家引擎自己的设置在哪儿。
 *
 * ## 为什么只摆路径，不做成表单
 *
 * 因为那些设置是**它们的**。omni 在这儿做一套输入框，就得跟着各家的格式、默认值、
 * 生效时机走——而它们改的时候不会通知我们，于是界面上摆着一份过期的、
 * 看起来还能用的设置。这就是 `AGENTS.md` 总纲说的那条线：**共建者，不是上下级。**
 *
 * 但「配置在哪儿」omni 是知道的（它本来就要读这些文件算钩子），而用户往往不知道。
 * 把路径摆出来 + 一颗「打开」，正好落在两者之间——**指出门，不代替开门。**
 *
 * ## 为什么把「还没有这个文件」也画出来
 *
 * 「文件不存在」和「文件里没配」都表现为「没效果」，而用户来这一页问的正是
 *「我配了为什么不生效」。分开说才答得了。
 */
export function EngineDoors({
  cwd,
  onReveal,
}: {
  cwd: string | undefined
  onReveal: (path: string) => void
}): React.JSX.Element {
  // `undefined` = 还没回来；空数组 = 真的一个都没有。**两件事说的话不一样**
  const [doors, setDoors] = useState<readonly EngineDoor[] | undefined>(undefined)
  const bridge = typeof window === "undefined" ? undefined : window.omni

  useEffect(() => {
    let live = true
    void bridge?.engineDoors(cwd).then((list) => {
      if (live) setDoors(list)
    })
    return () => {
      live = false
    }
  }, [bridge, cwd])

  if (doors === undefined) return <p className="doors__wait">正在看…</p>
  return (
    <div className="doors">
      {doors.map((door) => (
        <div key={`${door.id}:${door.scope}:${door.path}`} className="doors__row">
          <span className="doors__who">
            {door.label}
            <span className={`doors__scope doors__scope--${door.scope}`}>{SCOPE[door.scope]}</span>
          </span>
          <span className="doors__path" title={door.path}>
            {door.path}
          </span>
          <span className="doors__note">{door.exists ? door.note : "还没有这个文件"}</span>
          {/* **不存在的那几行不给「打开」**：点了什么都不会发生，那正是「点了没反应」 */}
          {door.exists ? (
            <button
              type="button"
              className="tbtn"
              title="在访达中显示"
              onClick={() => {
                onReveal(door.path)
              }}
            >
              <RevealIcon size={13} />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

const SCOPE: Readonly<Record<EngineDoor["scope"], string>> = {
  user: "用户",
  project: "项目",
  managed: "厂商维护",
}
