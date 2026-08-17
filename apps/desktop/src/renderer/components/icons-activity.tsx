import { LINE, Svg } from "./icon-base.js"

/*
 * ── 对话里发生的事：五种工具形态 + 思考 ──────────────
 *
 * 和 `icons.tsx`（界面骨架：文件夹、齿轮、箭头）分开放。
 * 拆是被行数闸门逼的，但这条边界本来就该有——一边是**壳**，一边是**内容**。
 * 画法的约定在 `icon-base.tsx` 里，两边共用。
 */

/** shell：光标提示符。**不画外框**——带框那版是 `EngineIcon`，同屏出现两个带框终端会分不清 */
export function TerminalIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M3 4.5 6.25 8 3 11.5M8.25 11.5h4.75" {...LINE} />
    </Svg>
  )
}

/** file_edit：一支笔。写字那一头朝右下，和读取那个「翻开的页」形状上分得开 */
export function PencilIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M10.6 2.9 13.1 5.4 5.9 12.6 2.6 13.4 3.4 10.1z" {...LINE} />
      <path d="M9.4 4.1 11.9 6.6" {...LINE} />
    </Svg>
  )
}

/** file_read：一页纸，右上角折角 */
export function FileIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M9 2.2H4.4A1.2 1.2 0 0 0 3.2 3.4v9.2a1.2 1.2 0 0 0 1.2 1.2h7.2a1.2 1.2 0 0 0 1.2-1.2V5.9z" {...LINE} />
      <path d="M9 2.2v3.7h3.8" {...LINE} />
    </Svg>
  )
}

/** fetch：地球。经线一条就够，画满会在 13px 上糊成一团 */
export function GlobeIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="5.4" {...LINE} />
      <path d="M2.6 8h10.8M8 2.6c1.5 1.5 2.2 3.4 2.2 5.4S9.5 11.9 8 13.4C6.5 11.9 5.8 10 5.8 8s.7-3.9 2.2-5.4z" {...LINE} />
    </Svg>
  )
}

/** other：认不出的调用。方块加一个点——**刻意不表达任何语义**，因为我们确实不知道它在干什么 */
export function DotBoxIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2.4" {...LINE} />
      <circle cx="8" cy="8" r="1.15" fill="currentColor" />
    </Svg>
  )
}

/** 思考。灯泡太像「提示」，脑袋太具象——用一个想法气泡 */
export function ThinkIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M12.25 11.2H7.05L4.25 13.3v-2.1H3.75a1.4 1.4 0 0 1-1.4-1.4V4.1a1.4 1.4 0 0 1 1.4-1.4h8.5a1.4 1.4 0 0 1 1.4 1.4v5.7a1.4 1.4 0 0 1-1.4 1.4z" {...LINE} />
      <path d="M6 6.9h.01M8 6.9h.01M10 6.9h.01" {...LINE} />
    </Svg>
  )
}

/** 恢复默认。一个绕回去的箭头——**不是垃圾桶**：这是撤销一次设置，不是删除什么 */
export function ResetIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M2.8 6.6A5.4 5.4 0 1 1 2.7 9.3" {...LINE} />
      <path d="M2.4 3.1v3.6h3.6" {...LINE} />
    </Svg>
  )
}
