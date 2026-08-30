/**
 * 触发器上显示的模型名。
 *
 * ## 为什么要裁
 *
 * 输入区那一排在窄列下会让标签省略（`.composer__bar > .trigger` 的
 * `flex-shrink: 1`，那条是对的——不然内容宽度会撑破输入卡）。省略本身不是问题：
 * `只读 / 自动审批 / 完全访问` 少一个字照样分得出，`Claude C…` 也还认得出是哪家。
 *
 * **`Default (recommen…)` 是另一回事**——被截掉的是名字，留下的是一句
 * 与身份无关的推荐语。同样的宽度里，`Default` 是完整的。
 *
 * ## 为什么在这一层裁，而不是改数据
 *
 * `(recommended)` 是**引擎自己报的** `ModelOption.label`，omni 没有加过一个字。
 * 改掉它等于替引擎改它自报的东西。所以这里只做**显示**：全名照旧进菜单
 * （`sectionsOf` 用的是 `m.label`），也照旧进触发器的悬停。
 *
 * ## 只裁尾部的圆括号
 *
 * 方括号不裁：`gpt-5.6-sol[low]` 里那一段是强度，是身份的一部分。
 * 中英文括号都认。裁完剩空的不裁——`(beta)` 这种整个名字就是一对括号时，
 * 裁了就什么都不剩。多层括号只脱一层，宁可少裁。
 */
const TAIL = /^(.*\S)\s*[（(][^（()）]*[)）]$/

export function triggerLabel(label: string): string {
  const head = TAIL.exec(label)?.[1]
  return head === undefined || head.length === 0 ? label : head
}
