import type { TurnPace } from "@switchback/protocol"
import { paceLine, spent } from "../status.js"
import { useLocale } from "../i18n.js"
import { TURN_MARK } from "./turn-mark.messages.js"

/**
 * 分界线上那句话：`已处理 2 分 11 秒 · 首字 0.8 秒 · 34 tok/s`。
 *
 * 节奏是宿主在那一轮收工时量好、跟着它落了盘的（`TurnPace`），所以翻回半个月前的那一轮也在；
 * 量不到的轮次（抄过来的历史、一个字都没写就停了）只说时长。
 * 放在分界线上而不是回答末尾：分界线本来就是「这一轮花了多久」的表头，而且折起来也还在。
 */
export function TurnMarkText({ ms, pace }: { ms: number; pace: TurnPace | undefined }): React.JSX.Element {
  const locale = useLocale()
  const m = TURN_MARK[locale]
  return (
    <span>
      {m.worked(spent(ms, locale))}
      {/* 悬停在节奏那半句上时的说明：两个数各是怎么量的 */}
      {pace === undefined ? null : (
        <span className="turnmark__pace" title={m.paceTip}>
          {" · "}
          {paceLine(pace, locale)}
        </span>
      )}
    </span>
  )
}
