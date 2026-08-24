/**
 * 深空态那层星点。**只在落到最贵那一档时才有**——普通档的条子是中性灰坡道，
 * 一颗星都不长。
 */

/** 星点位置的种子序列。**位置固定、不随重绘跳动**——跳来跳去会读成「它在闪什么」。 */
function seeded(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * 星点层。
 *
 * 上一版三处不对，是对着截图一条条改的：
 *
 * 1. **数量写死 10 颗**，208px 上摊下来每 20px 才一颗——那不是星空，是几粒灰。
 *    现在按宽度给（`w / 15`），三档模型的短条子也不会显得空。
 * 2. **`t²` 把点全堆在了左边**，而原来的注释写的是「密度往右加」——
 *    平方是把均匀分布压向 0，方向正好写反了。左密其实是对的
 *    （靛蓝那头最深，星点只有在深底上才读成星星），所以保留左密，
 *    但换成 `t^1.6`：右边那截也留几颗，不至于半条空着。
 * 3. **1px 的方块套一个 4px 的白光晕**，读出来是脏点不是星。现在光晕跟着
 *    自己的大小走（CSS 里 `calc(var(--s) * 1.4)`），并且只有每第三颗
 *    才是带芒的四角星（`.lit`），其余是圆点——**一屏里芒星是少数才像星空**。
 */
export function Stars({ width }: { width: number }): React.JSX.Element {
  const count = Math.max(9, Math.round(width / 15))
  return (
    <span className="effort__stars" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const t = seeded(i * 4 + 1)
        const size = 1.4 + seeded(i * 4 + 2) * 1.8
        return (
          <i
            key={i}
            className={i % 3 === 1 ? "lit" : undefined}
            style={
              {
                left: `${String(Math.round(Math.pow(t, 1.6) * (width - 6) + 3))}px`,
                top: `${String(3 + Math.round(seeded(i * 4 + 3) * 19))}px`,
                "--s": `${size.toFixed(1)}px`,
                animationDelay: `${(seeded(i * 4 + 4) * -2.6).toFixed(2)}s`,
              } as React.CSSProperties
            }
          />
        )
      })}
    </span>
  )
}
