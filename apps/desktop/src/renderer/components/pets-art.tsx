import type { PetShape } from "../pets.js"
import { DshPet } from "./dsh-art.js"

/*
 * 桌宠的形。颜色走 `currentColor` / `var(--pet-eye)`。每一种眼睛都单独挂
 * `.pet__eyes`，让眨眼、注视和休眠状态只操作眼层，不牵动身体。
 */

/** 史莱姆。`rx="7"` 的圆角方块——原案就是这个形，别改成真圆顶。 */
export function Slime(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect className="pet__shell" x="2" y="2" width="20" height="20" rx="7" fill="currentColor" />
      <g className="pet__eyes" fill="var(--pet-eye)">
        <rect x="8" y="9" width="2.6" height="6" rx="1.3" />
        <rect x="13.4" y="9" width="2.6" height="6" rx="1.3" />
      </g>
    </svg>
  )
}

/** 公开版不带 Claude 的形象，这一格画成史莱姆。 */
export function Crab(): React.JSX.Element {
  return <Slime />
}

export function PetArt({ shape }: { shape: PetShape }): React.JSX.Element {
  if (shape === "crab") return <Crab />
  if (shape === "dsh-mark") return <DshPet />
  return <Slime />
}
