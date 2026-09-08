import { LINE, Svg } from "./icon-base.js"

/** 两段相接的线，共用同一条工作线。品牌与空会话共用这个记号。 */
export function OmniMark({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <span className="omni-mark" aria-hidden="true">
      <Svg size={size}>
        <path d="M9 3H5a4 4 0 0 0 0 8h2M7 13h4a4 4 0 0 0 0-8H9" {...LINE} />
      </Svg>
    </span>
  )
}
