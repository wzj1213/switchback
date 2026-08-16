import { useEffect, useRef } from "react"
import type { SlashCommand } from "@omni/protocol"
import {
  CommandIcon,
  CompareIcon,
  CopyIcon,
  ForkIcon,
  GearIcon,
  PlusIcon,
  ShieldIcon,
  StopOutlineIcon,
} from "./icons.js"
import { PencilIcon } from "./icons-activity.js"

/**
 * omni 自己那几条各配各的图标——**它们和界面上已有的动作是同一件事**，
 * 用同一个图标，人在两处认的是同一个东西。
 * 引擎报的一律用中性图标：我们不知道它们会做什么。
 */
const GLYPH: Readonly<Record<string, React.ReactNode>> = {
  new: <PlusIcon />,
  rename: <PencilIcon size={15} />,
  env: <ShieldIcon />,
  export: <CopyIcon size={15} />,
  fork: <ForkIcon size={15} />,
  handoff: <ForkIcon size={15} />,
  compare: <CompareIcon size={15} />,
  stop: <StopOutlineIcon />,
  settings: <GearIcon />,
}

/**
 * `/` 命令面板。
 *
 * 形制照 codex 的那张：图标 + 命令名在左，说明右对齐。
 * 说明右对齐是有理由的——命令名长短不一，说明左对齐会跟着参差；
 * 而人扫这张表是**先扫左边一列名字**，扫到了再往右看一眼。
 *
 * ## 两边怎么分得出来
 *
 * 引擎报的命令会**发给引擎**，omni 自己的**就地执行**——行为不同，得看得出。
 * 上一版是在每行挂一个 `omni` 灰角标，十行就是十个角标，
 * 而它们说的是同一件事：噪声。
 *
 * 现在靠**图标**分：omni 那几条各用界面上已有的那个动作的图标
 *（新建是加号、重命名是笔、对比是对比…），引擎的一律中性方括号。
 * 顺带名字也不一样——omni 的显示中文名（「新建会话」），
 * 引擎的显示 `/code-review`，因为那本来就是它的名字。
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
          // 和上一条来源不同就在上面画一道线。**分组是给「行为不同」用的**：
          // omni 那几条就地执行，引擎那些填进输入框
          data-first-of-kind={command.source !== commands[i - 1]?.source}
          className={`slash__row${i === active ? " slash__row--active" : ""}`}
          // 和 `@` 一样用 mousedown：click 之前输入框会先失焦，
          // 失焦会把面板关掉，于是这一下点了个空
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(command)
          }}
        >
          <span className="slash__icon">
            {(command.source === "omni" ? GLYPH[command.name] : undefined) ?? <CommandIcon />}
          </span>
          <span className="slash__name">
            {command.label ?? `/${command.name}`}
            {command.argumentHint === undefined ? null : (
              <span className="slash__args"> {command.argumentHint}</span>
            )}
          </span>
          <span className="slash__desc">{command.description}</span>
        </button>
      ))}
    </div>
  )
}
