/*
 * 三只的形。**逐字沿用最初那版设计稿**——史莱姆两只（kimi / grok，只差颜色）、
 * Claude 那一格公开版不带它的形象，画成史莱姆。我试着自己重画过一版，画丑了：
 * 史莱姆画成了素面圆顶，重画只会画没。
 *
 * 改的只有两处，都是为了接进这套界面：
 * - 颜色从写死改成 `currentColor` / `var(--pet-eye)`，配色由 `.pet--<tone>` 给；
 * - 眼睛单独一组挂 `.pet__eyes`，眨眼靠在它身上压 `scaleY`（见 pets.css）。
 */

/** 史莱姆。`rx="7"` 的圆角方块——原案就是这个形，别改成真圆顶。 */
export function Slime(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="7" fill="currentColor" />
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
