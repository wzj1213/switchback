/**
 * 设置面板里反复出现的三个小件：分组、一行设置项、三段式开关。
 *
 * ## 为什么单独一个文件
 *
 * 一是行数闸门（面板本身要管「切哪一页」，塞不下）；二是它们**被四个分页共用**，
 * 原来挂在 `SettingsPanel` 上导出，于是 `EngineVersions` 要反过来 import 面板——
 * 一个小件和一整块面板互相引用，改哪边都要担心另一边。
 */

export function Group({ title, hint, children }: {
  title: string
  /** 这一组整体要交代的一句话。**不是每组都有**——没话说就别硬写。 */
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="set__group">
      <h3 className="set__title">{title}</h3>
      {hint === undefined ? null : <p className="set__note">{hint}</p>}
      <div className="set__rows">{children}</div>
    </section>
  )
}

/**
 * 一行一件事：左边说明，右边控件。**说明必须写全**——
 * 设置项的名字（「信任档」）说不出改了会怎样，而那正是用户在这里想知道的。
 *
 * `stack` 是给**宽控件**用的：五家引擎并排的那个开关占掉大半行宽，
 * 挤在右边会把左边那句说明压成每行两三个字（改之前就是这样）。
 * 那时让控件自己占一整行，说明写在上面——**判据是控件宽不宽，不是重不重要**。
 */
export function Field({ label, hint, stack, children }: {
  label: string
  hint?: string
  stack?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`set__field${stack === true ? " set__field--stack" : ""}`}>
      <div className="set__text">
        <span className="set__label">{label}</span>
        {hint === undefined ? null : <span className="set__hint">{hint}</span>}
      </div>
      <div className="set__control">{children}</div>
    </div>
  )
}

/** 三段式开关。选项少且互斥时比下拉好：**几个都看得见，不用点开才知道有什么**。 */
export function Segmented<T extends string>({ options, value, onPick }: {
  options: readonly { id: T; label: string }[]
  value: T
  onPick: (id: T) => void
}): React.JSX.Element {
  return (
    <div className="switch" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          className={`switch__item${option.id === value ? " switch__item--on" : ""}`}
          onClick={() => {
            onPick(option.id)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
