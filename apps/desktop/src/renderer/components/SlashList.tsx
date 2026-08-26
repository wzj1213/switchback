import { Fragment, useEffect, useRef } from "react"
import type { SlashCommand } from "@omni/protocol"
import { markOf } from "../slash.js"
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
  query,
  active,
  onPick,
}: {
  commands: readonly SlashCommand[]
  /** 斜杠后面已经打了什么。用来把名字里命中的那几个字加粗，见 `Marked`。 */
  query: string
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
        <Fragment key={`${command.source}:${command.name}`}>
          {/* 来源一变就起一节。**分节是给「行为不同」用的**：
              引擎的技能发给引擎，omni 那几条就地执行 */}
          {command.source === commands[i - 1]?.source ? null : (
            <div className="slash__head">{SECTION[command.source]}</div>
          )}
          <Row command={command} query={query} active={i === active} onPick={onPick} />
        </Fragment>
      ))}
    </div>
  )
}

/** 分节抬头的字。照 codex 那张：小字、灰、贴在第一条上面。 */
const SECTION: Readonly<Record<SlashCommand["source"], string>> = {
  engine: "技能",
  omni: "omni",
}

/**
 * 「这条命令是哪儿来的」，画在最右边——codex 那张图上就是这一列。
 *
 * 不是装饰：`system` 是引擎自带的，`user` 是你自己写的，
 * **出了问题该去改哪儿完全不同**。
 */
const SCOPE: Readonly<Record<NonNullable<SlashCommand["scope"]>, string>> = {
  user: "个人",
  project: "项目",
  system: "系统",
}

/**
 * 名字里被打中的那几个字加粗。
 *
 * **一张 46 行的表和一次补全的差别就在这儿**：打了 `/de` 之后，
 * 「它们都以 de 开头」这条规律得你自己看出来；而加粗是这张表在回答
 * 「我按你打的字在跟」。判据在 `slash.ts` 的 `markOf`——
 * 只在名字里找，说明命中时不去名字里瞎指一处。
 */
function Marked({ text, query }: { text: string; query: string }): React.JSX.Element {
  const mark = markOf(text, query)
  if (mark === undefined) return <>{text}</>
  return (
    <>
      {mark[0]}
      <span className="slash__hit">{mark[1]}</span>
      {mark[2]}
    </>
  )
}

function Row({
  command,
  query,
  active,
  onPick,
}: {
  command: SlashCommand
  query: string
  active: boolean
  onPick: (command: SlashCommand) => void
}): React.JSX.Element {
  // 引擎技能的 label 是 displayName（「berth 收编」），但真正要打进输入框的是
  // `name`。两者不同就把 `/name` 也画出来——菜单上显示一个、插进去另一个，
  // 第一次遇到时人会以为自己点错了
  const named = command.label !== undefined && command.label !== command.name
  return (
    <button
      type="button"
      role="option"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      data-active={active}
      className={`slash__row${active ? " slash__row--active" : ""}`}
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
        <Marked text={command.label ?? `/${command.name}`} query={query} />
        {command.argumentHint === undefined ? null : (
          <span className="slash__args"> {command.argumentHint}</span>
        )}
        {named ? (
          <span className="slash__slug">
            /<Marked text={command.name} query={query} />
          </span>
        ) : null}
      </span>
      <span className="slash__desc">{command.description}</span>
      {command.scope === undefined ? null : <span className="slash__scope">{SCOPE[command.scope]}</span>}
    </button>
  )
}
