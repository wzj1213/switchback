import { useRef, useState } from "react"
import { CaretIcon, ChevronIcon } from "./icons.js"
import { ResetIcon } from "./icons-activity.js"
import { Popover } from "./Popover.js"
import { Page } from "./SelectPage.js"

/**
 * 自绘下拉。替掉所有原生 `<select>`——理由见 `Popover.tsx` 开头。
 *
 * ## 一节的时候平铺，多节的时候分层
 *
 * 模型与推理强度本来是两个下拉，摆在一起就是两个控件、两次点击，
 * 而它们说的是同一件事（「这一轮用多强的脑子」）。所以收进一个触发器。
 *
 * **但不能全摊在一页上。** 上一版把两节直接铺开，实测是 13 条、592px 的内容
 * 挤进 418px 的面板——**要够到「推理强度」得先划过七个模型**。
 * 而且那时候面板上看不到「当前是什么配置」，得自己在列表里找那个勾。
 *
 * 现在照 codex 的做法分两层：顶层一行一节，右边写着**当前值**
 *（模型 GPT-5.6-Sol › / 推理强度 最高 ›），点进去才是选项。
 * 顶层那几行本身就是一份配置摘要，这是平铺给不了的。
 *
 * 一节的时候（引擎、信任档）**照旧平铺**：为一个选项列表套一层菜单，
 * 只是多一次点击。分层是给「多件事挤在一个面板里」用的。
 */

export interface Choice {
  id: string
  label: string
  description?: string
  /** 探测出「没装」之类的附注，显示在右侧。 */
  note?: string
}

export interface Section {
  /**
   * 这一节叫什么。多节时它是顶层菜单里那一行的标题，**必填才有意义**；
   * 只有一节时不显示——一个孤零零的分节标题只是噪声。
   */
  title?: string
  choices: readonly Choice[]
  /** 当前值。 */
  value: string | undefined
  onPick: (id: string) => void
}

export interface SelectProps {
  /** 触发器上显示的文字。 */
  label: string
  /** 触发器前面的小图标，可选。 */
  icon?: React.ReactNode
  title?: string
  disabled?: boolean
  sections: readonly Section[]
  /**
   * 顶层菜单末尾那一行「恢复默认」。**只在分层时出现**——
   * 平铺的面板里它会和选项挤成一排，看起来像第 N 个选项。
   */
  reset?: { label: string; run: () => void }
}

export function Select({
  label,
  icon,
  title,
  disabled = false,
  sections,
  reset,
}: SelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  /** 钻进了第几节。`undefined` = 停在顶层。一节的时候没有顶层，恒为 0。 */
  const [page, setPage] = useState<number | undefined>(undefined)
  const trigger = useRef<HTMLButtonElement>(null)
  const many = sections.length > 1
  const shown = many ? page : 0

  const close = (): void => {
    setOpen(false)
    // **关的时候退回顶层。** 不退的话下次点开还停在上次那一节，
    // 而那时候人想看的通常是「现在是什么配置」——那是顶层才有的信息
    setPage(undefined)
  }

  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={`trigger${open ? " trigger--open" : ""}`}
        title={title ?? label}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) close()
          else setOpen(true)
        }}
      >
        {icon === undefined ? null : <span className="trigger__icon">{icon}</span>}
        <span className="trigger__label">{label}</span>
        <CaretIcon />
      </button>
      <Popover
        open={open}
        anchor={trigger.current}
        minWidth={220}
        contentKey={shown ?? "top"}
        onClose={close}
      >
        <div role="menu" aria-label={title ?? label}>
          {shown === undefined ? (
            <Top sections={sections} reset={reset} onOpen={setPage} onClose={close} />
          ) : (
            <Page
              section={sections[shown]}
              onBack={
                many
                  ? () => {
                      setPage(undefined)
                    }
                  : undefined
              }
              onClose={close}
            />
          )}
        </div>
      </Popover>
    </>
  )
}

/**
 * 顶层：一行一节，右边写着当前值。
 *
 * **右边那个值不是装饰**——它让这个面板同时是一份「现在什么配置」的摘要，
 * 而平铺的版本要自己去列表里找那个勾。
 */
function Top({
  sections,
  reset,
  onOpen,
  onClose,
}: {
  sections: readonly Section[]
  reset: SelectProps["reset"]
  onOpen: (index: number) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <>
      {sections.map((section, index) => (
        <button
          key={section.title ?? String(index)}
          type="button"
          className="pop__item pop__item--row"
          role="menuitem"
          onClick={() => {
            onOpen(index)
          }}
        >
          <span className="pop__label">{section.title ?? "选项"}</span>
          <span className="pop__value">{currentLabel(section)}</span>
          <ChevronIcon open={false} size={12} />
        </button>
      ))}
      {reset === undefined ? null : (
        <button
          type="button"
          className="pop__item pop__item--row pop__item--reset"
          role="menuitem"
          onClick={() => {
            reset.run()
            onClose()
          }}
        >
          <span className="pop__label">{reset.label}</span>
          <ResetIcon />
        </button>
      )}
    </>
  )
}

/** 当前值那一段文字。没选过就说「默认」——比留一片空白说得清楚。 */
function currentLabel(section: Section): string {
  const hit = section.choices.find((c) => c.id === section.value)
  return hit?.label ?? "默认"
}
