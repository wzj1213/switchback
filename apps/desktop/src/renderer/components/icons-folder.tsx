import { LINE, Svg } from "./icon-base.js"

/*
 * 文件夹：项目组的图标。**开/合两只顶替展开箭头**（作者拍板照 Codex）——
 * 合上是「这个项目折着」，打开是「它正摊着」。
 * 从 `icons.tsx` 拆出来是行数闸门逼的（那个文件本来就顶在 200 上）。
 */

export function FolderIcon({ size }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M2 4.25A1.25 1.25 0 0 1 3.25 3h2.4l1.35 1.5h5.75A1.25 1.25 0 0 1 14 5.75v6A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75z" {...LINE} />
    </Svg>
  )
}

export function FolderOpenIcon({ size }: { size?: number } = {}): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M2 11.75V4.25A1.25 1.25 0 0 1 3.25 3h2.4l1.35 1.5h5.75A1.25 1.25 0 0 1 14 5.75V7.1" {...LINE} />
      <path d="M2 11.75 3.06 8.6a1.25 1.25 0 0 1 1.19-1.15h9.28a1 1 0 0 1 .96 1.28l-1.03 3.5a1.25 1.25 0 0 1-1.19 1.02H3.46A1.25 1.25 0 0 1 2 12.25v-.5z" {...LINE} />
    </Svg>
  )
}
