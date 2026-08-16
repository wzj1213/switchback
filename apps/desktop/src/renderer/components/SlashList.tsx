import { useEffect, useRef } from "react"
import type { SlashCommand } from "@omni/protocol"

/**
 * `/` 命令面板。
 *
 * 形制照 codex 的那张：图标 + 命令名在左，说明右对齐。
 * 说明右对齐是有理由的——命令名长短不一，说明左对齐会跟着参差；
 * 而人扫这张表是**先扫左边一列名字**，扫到了再往右看一眼。
 *
 * ## 为什么 omni 自己的命令要标出来
 *
 * 引擎报的命令会**发给引擎**，omni 自己的**就地执行**。
 * 两者行为不同，界面上不能长得一模一样——尤其在断线的历史会话里，
 * 引擎那半根本按不动。
 */
export function SlashList({
  commands,
  active,
  onPick,
}: {
  commands: readonly SlashCommand[]
  active: number
  onPick: (command: SlashCommand) => void
}): React.JSX.Element | null {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    box.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (commands.length === 0) return null
  return (
    <div className="slash" ref={box} role="listbox">
      {commands.map((command, i) => (
        <button
          key={`${command.source}:${command.name}`}
          type="button"
          role="option"
          aria-selected={i === active}
          data-active={i === active}
          className={`slash__row${i === active ? " slash__row--active" : ""}`}
          // 和 `@` 一样用 mousedown：click 之前输入框会先失焦，
          // 失焦会把面板关掉，于是这一下点了个空
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(command)
          }}
        >
          <span className="slash__name">
            /{command.name}
            {command.argumentHint === undefined ? null : (
              <span className="slash__args"> {command.argumentHint}</span>
            )}
          </span>
          {command.source === "omni" ? <span className="slash__badge">omni</span> : null}
          <span className="slash__desc">{command.description}</span>
        </button>
      ))}
    </div>
  )
}
