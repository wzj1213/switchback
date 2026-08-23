import { CheckIcon } from "./icons.js"
import type { Choice, Section } from "./Select.js"

/**
 * 分层下拉的二级页与选项行。
 *
 * 从 `Select.tsx` 拆出来是行数闸门逼的，边界也顺：
 * 那边是「触发器 + 顶层摘要」，这边是「某一节里逐条挑」。
 */

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
        {choice.description === undefined ? null : (
          <span className="pop__desc">{choice.description}</span>
        )}
      </span>
      {choice.note === undefined ? null : <span className="pop__note">{choice.note}</span>}
    </button>
  )
}

/** 某一节的选项列表。多节时顶上有一行返回。 */
export function Page({
  section,
  onBack,
  onClose,
}: {
  section: Section | undefined
  onBack?: () => void
  onClose: () => void
}): React.JSX.Element | null {
  if (section === undefined) return null
  return (
    <>
      {onBack === undefined ? null : (
        <button type="button" className="pop__back" role="menuitem" onClick={onBack}>
          <span className="pop__back-arrow" aria-hidden="true">
            ‹
          </span>
          {section.title ?? "返回"}
        </button>
      )}
      <div className="pop__section">
        {section.choices.map((choice) => (
          <Item
            key={choice.id}
            choice={choice}
            selected={choice.id === section.value}
            onPick={() => {
              section.onPick(choice.id)
              // 选完就关。多选面板才需要留着，这里每一节都是单选
              onClose()
            }}
          />
        ))}
      </div>
    </>
  )
}
