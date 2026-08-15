import { useRef, useState } from "react"
import { CaretIcon, CheckIcon } from "./icons.js"
import { Popover } from "./Popover.js"

/**
 * 自绘下拉。替掉所有原生 `<select>`——理由见 `Popover.tsx` 开头。
 *
 * ## 分组是必须的，不是装饰
 *
 * 模型与推理强度本来是两个下拉，摆在一起就是两个控件、两次点击，
 * 而它们说的是同一件事（「这一轮用多强的脑子」）。codex 把它们收进
 * 同一个面板，omni 照这个思路：**一个触发器，面板里分节**。
 *
 * 不做二级菜单：二级菜单要多一次悬停、多一次误关，
 * 而分节把同样的信息一次全摊开——三十几个模型也只是滚一下的事。
 */

export interface Choice {
  id: string
  label: string
  description?: string
  /** 探测出「没装」之类的附注，显示在右侧。 */
  note?: string
}

export interface Section {
  /** 只有一节时不显示标题——一个孤零零的分节标题只是噪声。 */
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
}

function Item({
  choice,
  selected,
  onPick,
}: {
  choice: Choice
  selected: boolean
  onPick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`pop__item${selected ? " pop__item--on" : ""}`}
      role="menuitemradio"
      aria-checked={selected}
      onClick={onPick}
    >
      <span className="pop__check">{selected ? <CheckIcon /> : null}</span>
      <span className="pop__text">
        <span className="pop__label">{choice.label}</span>
        {choice.description === undefined ? null : <span className="pop__desc">{choice.description}</span>}
      </span>
      {choice.note === undefined ? null : <span className="pop__note">{choice.note}</span>}
    </button>
  )
}

export function Select({ label, icon, title, disabled = false, sections }: SelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const many = sections.length > 1

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
          setOpen((was) => !was)
        }}
      >
        {icon === undefined ? null : <span className="trigger__icon">{icon}</span>}
        <span className="trigger__label">{label}</span>
        <CaretIcon />
      </button>
      <Popover
        open={open}
        anchor={trigger.current}
        minWidth={200}
        onClose={() => {
          setOpen(false)
        }}
      >
        <div role="menu">
          {sections.map((section, index) => (
            <div className="pop__section" key={section.title ?? String(index)}>
              {many && section.title !== undefined ? <div className="pop__title">{section.title}</div> : null}
              {section.choices.map((choice) => (
                <Item
                  key={choice.id}
                  choice={choice}
                  selected={choice.id === section.value}
                  onPick={() => {
                    section.onPick(choice.id)
                    // 选完就关。多选面板才需要留着，这里每一节都是单选
                    setOpen(false)
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </Popover>
    </>
  )
}
