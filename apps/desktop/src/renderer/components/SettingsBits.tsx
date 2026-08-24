/**
 * 设置面板里反复出现的那几个小件：分组、一行设置项、三段式开关、二元开关、
 * 空/错状态那句话、卡片底下那条页脚。
 *
 * ## 为什么单独一个文件
 *
 * 一是行数闸门（面板本身要管「切哪一页」，塞不下）；二是它们**被每一个分页共用**，
 * 原来挂在 `SettingsPanel` 上导出，于是 `EngineVersions` 要反过来 import 面板——
 * 一个小件和一整块面板互相引用，改哪边都要担心另一边。
 *
 * ## 为什么这几样必须是组件，不是「照着抄一遍 class」
 *
 * 抄的那份没有编译期反馈。远程那一页曾经**整页不套 `Group`**、自己手写了一遍
 * `switch` 的 radiogroup，于是它和别的页长得就是不一样，而没有任何东西会报错；
 * 三处异步面板各写了一句「正在读…」，措辞、字号、内边距三套。
 * 收进这里之后，「统一」是**默认结果**而不是每次都要记得的纪律。
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
  hint?: React.ReactNode
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
export function Segmented<T extends string>({ options, value, onPick, disabled }: {
  options: readonly { id: T; label: string }[]
  value: T
  onPick: (id: T) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="switch" role="radiogroup" aria-disabled={disabled === true}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          disabled={disabled === true}
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

/**
 * 二元开关。**开/关这一类一律用它，不再用「一颗会变色的按钮」。**
 *
 * 上一版里同一件事有三种画法：桌宠是两格的 `Segmented`（「显示 / 隐藏」）、
 * 远程访问是一颗写着「打开」的按钮（**按钮上的字是动作还是状态？两种读法都说得通**），
 * 新会话默认引擎是一颗写着「设为默认」的按钮。三种控件、三种读法，
 * 而它们回答的是同一个问题：这件事现在是开着还是关着。
 *
 * 拨块本身不写字：**位置就是状态**，而「开/关」这两个字放在开关上永远有歧义。
 * 要交代改了会怎样，写在 `Field` 的 `hint` 里——那儿有整行宽度。
 */
export function Toggle({ on, label, disabled, hint, onChange }: {
  on: boolean
  /** 读屏用的名字。视觉上的标题由 `Field` 给，这里不重复画一遍。 */
  label: string
  disabled?: boolean
  /** 变灰时**必须说清楚为什么**：一个点不动又不解释的开关是这套界面里最坏的东西。 */
  hint?: string
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled === true}
      title={hint ?? label}
      className={`toggle${on ? " toggle--on" : ""}`}
      onClick={() => {
        onChange(!on)
      }}
    >
      <span className="toggle__knob" aria-hidden="true" />
    </button>
  )
}

/**
 * 卡片里那句「正在读…」「还没有内容」「读失败了」。
 *
 * 三种状态一个出口。分开写的下场实测过：同一块面板里「正在确认配置来源…」
 * 「正在检查安装版本…」「正在读取 profile manifest…」三句话字号和内边距各不相同，
 * 而它们在用户眼里是同一件事（这一格还没准备好）。
 */
export function Blank({ tone = "muted", children }: {
  tone?: "muted" | "error"
  children: React.ReactNode
}): React.JSX.Element {
  const failed = tone === "error"
  return (
    <p className={`set__blank${failed ? " set__blank--error" : ""}`} {...(failed ? { role: "alert" } : {})}>
      {children}
    </p>
  )
}

/**
 * 卡片底下那条页脚。**画成页脚而不是又一行设置项**：
 * 放这儿的动作不改任何偏好，只是重跑一次探测、重读一遍磁盘。
 */
export function Actions({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="set__act">{children}</div>
}

/** 一行文本输入。样式与别处的控件同源，调一次全都跟着变。 */
export function Input({ value, placeholder, label, inputMode, onChange }: {
  value: string
  placeholder?: string
  label: string
  inputMode?: "numeric"
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <input
      className="set__input"
      aria-label={label}
      value={value}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...(inputMode === undefined ? {} : { inputMode })}
      onChange={(event) => {
        onChange(event.target.value)
      }}
    />
  )
}
