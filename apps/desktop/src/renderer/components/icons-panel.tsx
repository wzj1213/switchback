import { LINE, Svg } from "./icon-base.js"

/*
 * ── 面板与工具条上的图标 ──────────────────────────────
 *
 * 和 `icons.tsx`（骨架）、`icons-activity.tsx`（对话内容）并列的第三份。
 * 拆是被行数闸门逼的，但边界本来就该有：这一份画的是**容器上的动作**——
 * 关掉、铺满、收进侧边、切视图、刷新。
 *
 * ## 这一份是把八处「自己写 `<svg>`」收回来之后立的
 *
 * `icon-base.tsx` 的 `Svg` 按尺寸反向补偿笔画，让任何尺寸下屏幕上都是 1.25px。
 * 而实测有八处绕过了它，写死 `strokeWidth`：
 *
 * | 位置 | 尺寸 | 写死 | 实际笔画 |
 * | --- | --- | --- | --- |
 * | 计划步态环 | 11 | 1.35 | **0.93** |
 * | 全屏 | 12 | 1.5 | 1.13 |
 * | 审核四枚 + 跳转（写在 CSS 里） | 14 | 1.35 | 1.18 |
 * | 侧边面板（工作台内） | 13 | 1.5 | 1.22 |
 * | 回形针 | 14 | 1.45 | 1.27 |
 * | 侧边面板（顶栏） | 14 | 1.5 | **1.31** |
 *
 * 最粗与最细差 41%，而**最要命的一对是并排的**：工作台右上角那颗「全屏」
 * 和顶栏那颗「侧边面板」挨着，笔画差 16%。13px 下没人看得出是「粗细不同」，
 * 只会觉得那一排有点脏——这正是 `icon-base.tsx` 立那套补偿时修过的同一个毛病，
 * 它在别处又长回来了八次。所以这一轮连 `scripts/check-icons.mjs` 一起加。
 */

/**
 * 关掉。
 *
 * **必须是图标，不能是 `×` 字符。** 和 `EllipsisIcon` 一个理由，而且这里更严重：
 * 全仓七处关闭键，四处写 `×`（U+00D7）、三处写 `✕`（U+2715）——**同一个动作两种字形**，
 * 各自的字面宽度、笔画粗细、光学重心都不一样。更根本的是文字按**基线**排版，
 * 而它们都装在 `place-items: center` 的方盒子里：盒子居中的是**行盒**不是字形，
 * 于是每一颗 `×` 都比它看起来该在的位置偏高一点点，偏多少还跟着字号变。
 */
export function CloseIcon({ size = 13 }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" {...LINE} />
    </Svg>
  )
}

/**
 * 侧边面板。**一个盒子，右边一条竖线**——右侧那一栏。
 *
 * 顶栏（收起/展开整个工作台）和工作台自己的抬头（收回侧边）两处共用同一个形。
 * 改之前是两份复制出来的裸 `<svg>`，尺寸 14 / 13、笔画 1.31 / 1.22——
 * 同一个意思画了两遍，还画得不一样重。
 */
export function PanelIcon({ size = 14 }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <rect x="2" y="2.5" width="12" height="11" rx="2" {...LINE} />
      <path d="M10.5 2.5v11" {...LINE} />
    </Svg>
  )
}

/** 铺满。四个角往外顶——不是箭头，箭头在这套里已经是「去某处」的意思。 */
export function ExpandIcon({ size = 13 }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" {...LINE} />
    </Svg>
  )
}

/** 添加附件。回形针——这个隐喻不用解释，换成别的都要解释。 */
export function PaperclipIcon({ size = 14 }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <path
        d="M5.25 8.75 9.8 4.2a2.1 2.1 0 0 1 3 3l-5.5 5.5a3.35 3.35 0 0 1-4.75-4.75l5.2-5.2M5.1 10.15l5.35-5.35"
        {...LINE}
      />
    </Svg>
  )
}

/** 展开/收起全部差异上下文：三条长线 + 三个点，点那一侧是被折起来的行。 */
export function LinesIcon({ size = 14 }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M5 3h8M5 8h8M5 13h8M2.5 3h.01M2.5 8h.01M2.5 13h.01" {...LINE} />
    </Svg>
  )
}

/** 分栏差异：一个盒子从中间劈开，两边各有一条改动。 */
export function SplitIcon({ size = 14 }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <rect x="2" y="3" width="12" height="10" rx="2" {...LINE} />
      <path d="M8 3v10M4.5 6h1.5M10 10h1.5" {...LINE} />
    </Svg>
  )
}

/** 文件清单：一个文件夹里两条行。和 `FolderIcon` 分得开——那个是「一个项目」。 */
export function FileListIcon({ size = 14 }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M2.5 4.5h4l1-1h6v9h-11z" {...LINE} />
      <path d="M5 7h6M5 9.5h6" {...LINE} />
    </Svg>
  )
}

/** 在改动文件里跳转：一页纸 + 一个放大镜。**不复用 `SearchIcon`**——
    那颗是「搜会话」，同屏出现两个裸放大镜会指不清搜的是什么。 */
export function FileSearchIcon({ size = 14 }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M3 2.5h7l2 2v4M3 2.5v11h5" {...LINE} />
      <circle cx="11" cy="10.5" r="2.5" {...LINE} />
      <path d="M12.8 12.3 14.5 14" {...LINE} />
    </Svg>
  )
}
