/**
 * 图标。
 *
 * ## 为什么是内联 SVG，不是 emoji、不是字形、不是图标库
 *
 * - **emoji** 是彩色的，和这套单色界面不搭，而且各平台画得不一样。
 * - **字形**（`⌸`、`▾` 之类）在多数字体里会退化成一个含糊的方框。
 * - **图标库**要么进 bundle 几百 KB，要么从 CDN 拉——而这个应用是离线优先的。
 *
 * 内联 SVG 跟着 `currentColor` 走，所以 hover / 选中 / 禁用时颜色自动对，
 * 不用为每种状态各写一份。
 *
 * ## 一套画法
 *
 * 全部 16×16 视口、`stroke-width: 1.3`、圆角端点。混用描边和填充是图标看起来
 * 「不是一套」的最常见原因——所以这里只有描边，唯一的例外是需要表达
 * 「实心状态」的那几个（选中的勾、状态点）。
 */

const BOX = { viewBox: "0 0 16 16", fill: "none", "aria-hidden": true } as const
const LINE = { stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" } as const

function Svg({ size = 14, children }: { size?: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <svg width={size} height={size} {...BOX}>
      {children}
    </svg>
  )
}

export function FolderIcon(): React.JSX.Element {
  return (
    <Svg>
      <path d="M2 4.25A1.25 1.25 0 0 1 3.25 3h2.4l1.35 1.5h5.75A1.25 1.25 0 0 1 14 5.75v6A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75z" {...LINE} />
    </Svg>
  )
}

export function PlusIcon(): React.JSX.Element {
  return (
    <Svg>
      <path d="M8 3.5v9M3.5 8h9" {...LINE} />
    </Svg>
  )
}

export function SearchIcon(): React.JSX.Element {
  return (
    <Svg>
      <circle cx="7.25" cy="7.25" r="4" {...LINE} />
      <path d="M10.25 10.25 13.5 13.5" {...LINE} />
    </Svg>
  )
}

/** 展开/折叠。转 90° 而不是换成另一个图标——转动本身就说明了「同一个东西的两态」。 */
export function ChevronIcon({ open = false, size = 12 }: { open?: boolean; size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      {...BOX}
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }}
    >
      <path d="M6.25 3.5 10.5 8l-4.25 4.5" {...LINE} />
    </svg>
  )
}

/** 下拉触发器右侧那个。朝下，和展开用的那个区分开。 */
export function CaretIcon({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} {...BOX}>
      <path d="M4 6.5 8 10.5l4-4" {...LINE} />
    </svg>
  )
}

export function CheckIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} {...BOX}>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" {...LINE} />
    </svg>
  )
}

export function EngineIcon(): React.JSX.Element {
  return (
    <Svg>
      <rect x="3" y="3" width="10" height="10" rx="2.5" {...LINE} />
      <path d="M6.25 6.75 8 8.5l-1.75 1.75M9.5 10.25h1.75" {...LINE} />
    </Svg>
  )
}

export function ShieldIcon(): React.JSX.Element {
  return (
    <Svg>
      <path d="M8 2.5 12.5 4v4c0 2.6-1.9 4.6-4.5 5.5C5.4 12.6 3.5 10.6 3.5 8V4z" {...LINE} />
    </Svg>
  )
}

export function SparkIcon(): React.JSX.Element {
  return (
    <Svg>
      <path d="M8 2.5 9.3 6.2 13 7.5 9.3 8.8 8 12.5 6.7 8.8 3 7.5l3.7-1.3z" {...LINE} />
    </Svg>
  )
}

export function TrashIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M3.5 4.5h9M6.5 4.5V3.25h3V4.5M5 4.5l.5 8h5l.5-8" {...LINE} />
    </Svg>
  )
}

export function RevealIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M2.5 5.25A1.25 1.25 0 0 1 3.75 4H6l1.25 1.5h5A1.25 1.25 0 0 1 13.5 6.75l-.6 4.5A1.25 1.25 0 0 1 11.65 12.5H3.9a1.25 1.25 0 0 1-1.25-1.1z" {...LINE} />
    </Svg>
  )
}

export function CopyIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.5" {...LINE} />
      <path d="M10.5 5.5v-1A1.5 1.5 0 0 0 9 3H4.5A1.5 1.5 0 0 0 3 4.5V9a1.5 1.5 0 0 0 1.5 1.5h1" {...LINE} />
    </Svg>
  )
}

export function CompareIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M4 5.5h8M4 5.5 6 3.5M4 5.5 6 7.5M12 10.5H4M12 10.5 10 8.5M12 10.5 10 12.5" {...LINE} />
    </Svg>
  )
}

export function ForkIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <circle cx="4.5" cy="4" r="1.5" {...LINE} />
      <circle cx="11.5" cy="4" r="1.5" {...LINE} />
      <circle cx="8" cy="12" r="1.5" {...LINE} />
      <path d="M4.5 5.5v1A2 2 0 0 0 6.5 8.5h3a2 2 0 0 0 2-2v-1M8 8.5v2" {...LINE} />
    </Svg>
  )
}

export function GearIcon(): React.JSX.Element {
  return (
    <Svg>
      <circle cx="8" cy="8" r="2.15" {...LINE} />
      <path d="M8 2.2v1.4M8 12.4v1.4M13.8 8h-1.4M3.6 8H2.2M12.1 3.9l-1 1M4.9 11.1l-1 1M12.1 12.1l-1-1M4.9 4.9l-1-1" {...LINE} />
    </Svg>
  )
}

export function PinIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M9.5 2.5 13.5 6.5l-2 .6-3 3-.4 2.4-4.6-4.6 2.4-.4 3-3z" {...LINE} />
      <path d="M3.5 12.5 6 10" {...LINE} />
    </Svg>
  )
}
