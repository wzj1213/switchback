import { LINE, Svg } from "./icon-base.js"

export function ReloadIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <Svg size={size}>
      <path d="M12.8 5.3V2.7m0 0h-2.6m2.6 0A5.6 5.6 0 1 0 13.4 9" {...LINE} />
    </Svg>
  )
}
