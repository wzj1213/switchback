import { LINE, Svg } from "./icon-base.js"

/*
 * 界面骨架用的图标。对话内容里那几个（终端、笔、地球…）在 `icons-activity.tsx`。
 * 画法的约定、`Svg`/`LINE`/`BOX` 在 `icon-base.tsx`。
 */

export { Svg } from "./icon-base.js"

export function FolderIcon({ size }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M2 4.25A1.25 1.25 0 0 1 3.25 3h2.4l1.35 1.5h5.75A1.25 1.25 0 0 1 14 5.75v6A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75z" {...LINE} />
    </Svg>
  )
}

export function PlusIcon({ size }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M8 3.5v9M3.5 8h9" {...LINE} />
    </Svg>
  )
}

export function SearchIcon({ size }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <circle cx="7.25" cy="7.25" r="4" {...LINE} />
      <path d="M10.25 10.25 13.5 13.5" {...LINE} />
    </Svg>
  )
}

/** 展开/折叠。转 90° 而不是换成另一个图标——转动本身就说明了「同一个东西的两态」。 */
export function ChevronIcon({ open = false, size = 12 }: { open?: boolean; size?: number }): React.JSX.Element {
  return (
    <Svg size={size} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }}>
      <path d="M6.25 3.5 10.5 8l-4.25 4.5" {...LINE} />
    </Svg>
  )
}

/** 下拉触发器右侧那个。朝下，和展开用的那个区分开。 */
export function CaretIcon({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M4 6.5 8 10.5l4-4" {...LINE} />
    </Svg>
  )
}

export function CheckIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" {...LINE} />
    </Svg>
  )
}

export function EngineIcon({ size }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <rect x="3" y="3" width="10" height="10" rx="2.5" {...LINE} />
      <path d="M6.25 6.75 8 8.5l-1.75 1.75M9.5 10.25h1.75" {...LINE} />
    </Svg>
  )
}

export function ShieldIcon({ size }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M8 2.5 12.5 4v4c0 2.6-1.9 4.6-4.5 5.5C5.4 12.6 3.5 10.6 3.5 8V4z" {...LINE} />
    </Svg>
  )
}

export function SparkIcon({ size }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
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

export function GearIcon({ size }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
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

export function BranchIcon({ size }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <circle cx="5" cy="4" r="1.5" {...LINE} />
      <circle cx="5" cy="12" r="1.5" {...LINE} />
      <circle cx="11.5" cy="5.5" r="1.5" {...LINE} />
      <path d="M5 5.5v5M10 6.6c0 1.6-1.6 2.4-3 2.6-1 .15-2 .6-2 1.3" {...LINE} />
    </Svg>
  )
}

/*
 * ── 工具调用的五种形态 ────────────────────────────────
 *
 * 一种形态一个图标，和 `tool.ts` 的 `VERB` 表一一对应。
 * 图标替掉的是**动词**（执行/编辑/读取/请求/调用），不是整行——
 * 动词表本身不能删，还有状态行和 Markdown 导出两处在用它取字面文本。
 */







/** 回到底部。圆底加一个下箭头——codex 和 dsh 的那颗都是这个形状 */
export function ArrowDownIcon({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M8 3.2v9.6M4.2 9 8 12.8 11.8 9" {...LINE} />
    </Svg>
  )
}

/**
 * 转圈。**只画四分之三个圆**——整圈转起来看不出在转，缺口才是运动的证据。
 * 转动交给 CSS（`.row__spin`），这里只管形状。
 */
export function SpinnerIcon({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M8 2.4a5.6 5.6 0 1 1-5.6 5.6" {...LINE} />
    </Svg>
  )
}

/** 发送。**箭头朝上**，不是纸飞机——纸飞机在 13px 上只剩一团三角。 */
export function SendIcon({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M8 13V3.6M3.8 7.8 8 3.6l4.2 4.2" {...LINE} />
    </Svg>
  )
}

/**
 * 停止。**实心方块**，不是「×」——×是「关掉/取消这个界面」，
 * 而这里要说的是「让正在跑的东西停下」。播放器用了几十年的那个方块，不用重新发明。
 */
export function StopIcon({ size = 14 }: { size?: number }): React.JSX.Element {
  // 实心块，没有描边——但仍然走 `Svg`，免得下次有人照着它再写一个绕过去的
  return (
    <Svg size={size}>
      <rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.4" fill="currentColor" />
    </Svg>
  )
}

/**
 * 引擎报上来的那些命令共用的图标。
 *
 * **故意是个中性的方括号**：我们不知道 `/api-post` 或某个第三方技能到底会做
 * 什么，配一个「看起来像那么回事」的图标是在替它承诺。codex 给内置命令各配
 * 一个图标是因为那些是它自己的功能，它知道。
 */
export function CommandIcon({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M6.2 3.6H4.2v8.8h2M9.8 3.6h2v8.8h-2" {...LINE} />
    </Svg>
  )
}

/** 停止（面板里用的描边版，和输入区那颗实心方块区分开——那颗是按钮，这个是条目）。 */
export function StopOutlineIcon({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.6" {...LINE} />
    </Svg>
  )
}
