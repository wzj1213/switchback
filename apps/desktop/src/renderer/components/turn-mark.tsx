import type { TurnPace } from "@omni/protocol"
import { paceLine, spent } from "../status.js"

/** 悬停在节奏那半句上时的说明：两个数各是怎么量的。 */
const PACE_TIP =
  "首字：这一轮开跑，到模型第一次有输出。" +
  "速度：生成量 ÷ 真在出字的时间——工具在跑、下一次请求在等首字的那些空档都不算。" +
  "带 ≈ 的是引擎没报生成量，按写出来的字估的。"

/**
 * 分界线上那句话：`已处理 2 分 11 秒 · 首字 0.8 秒 · 34 tok/s`。
 *
 * 节奏是宿主在那一轮收工时量好、跟着它落了盘的（`TurnPace`），所以翻回半个月前的那一轮也在；
 * 量不到的轮次（抄过来的历史、一个字都没写就停了）只说时长。
 * 放在分界线上而不是回答末尾：分界线本来就是「这一轮花了多久」的表头，而且折起来也还在。
 */
export function TurnMarkText({ ms, pace }: { ms: number; pace: TurnPace | undefined }): React.JSX.Element {
  return (
    <span>
      已处理 {spent(ms)}
      {pace === undefined ? null : (
        <span className="turnmark__pace" title={PACE_TIP}>
          {" · "}
          {paceLine(pace)}
        </span>
      )}
    </span>
  )
}
