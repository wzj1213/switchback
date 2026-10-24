import { useState } from "react"
import type { ErrorItem } from "@switchback/protocol"
import { ChevronIcon } from "./icons.js"
import { AlertIcon } from "./icons-activity.js"
import { LinkifiedText } from "./linkified-text.js"
import { failureKind, humanize } from "../../shared/failure.js"
import type { SoftState } from "../error-plan.js"
import { useMessages } from "../i18n.js"
import { FAILURE } from "./Failure.messages.js"

/**
 * 报错。**先说人话，原文折起来**——翻出来的那句在上面，原文在「详情」里。
 *
 * 引擎原样吐出来的东西是一堵墙（三层 JSON 包着一句话，或者一串
 * `result_type=user last_content_type=n/a` 这种给引擎作者排查用的字段），
 * 但原文一个字都不能少：用户拿它去搜、去开 issue、去问引擎作者，
 * 那时候需要的恰恰是我们觉得没用的那部分。
 *
 * 两种分量，别混：
 *
 * - **可恢复的**（`SoftFailure`）：引擎说了「还在试，你不用做什么」。正在试的那一条
 *   把原因摆出来；试过去了的收成一行淡字，原因折进「详情」。
 * - **终态的**（`FailCard`）：这一轮停在这儿了。一张卡：抬头说是哪一类、下面是原话、
 *   能重来就给一颗「再试一次」。同一轮里在它前面的那几条重试并进来，不再另摆一遍。
 */

/** 「详情」那颗开关。整行都是热区，不是一个 12px 的小箭头。 */
function MoreToggle({ open, onToggle }: { open: boolean; onToggle: () => void }): React.JSX.Element {
  const m = useMessages(FAILURE)
  return (
    <button type="button" className="error__more" aria-expanded={open} onClick={onToggle}>
      {m.details}
      <ChevronIcon open={open} size={12} />
    </button>
  )
}

/** 一条可恢复的报错：正在重试的把原因摆出来；过去了的只留一行。 */
export function SoftFailure({ item, state = "past" }: { item: ErrorItem; state?: SoftState }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (state === "absorbed") return null
  const failure = humanize(item.message)
  const why = item.detail === undefined || item.detail === "" ? undefined : item.detail
  // 正在重试的那一条，「为什么断了」就是它全部的信息量（codex 的抬头只有 `Reconnecting... 1/5`）
  if (state === "live") {
    return (
      <div className="error--soft error--live" role="status">
        <span className="error__text">{failure.text}</span>
        {why === undefined ? null : <p className="error__why">{why}</p>}
      </div>
    )
  }
  const more = failure.detailed || why !== undefined
  return (
    <div className="error--soft">
      <div className="error__row">
        <span className="error__text">{failure.text}</span>
        {more ? <MoreToggle open={open} onToggle={() => { setOpen((v) => !v) }} /> : null}
      </div>
      {open ? <pre className="error__raw">{[item.message, why].filter((part) => part !== undefined).join("\n\n")}</pre> : null}
    </div>
  )
}

/** 并进终态卡里的那几条，给「详情」用：原话连同引擎补的原因。 */
function priorText(prior: readonly ErrorItem[]): string {
  return prior.map((item) => (item.detail === undefined ? item.message : `${item.message} — ${item.detail}`)).join("\n")
}

/** 抬头下面那几行小字：引擎补的原因、被并进来的那几条、Switchback 手里有的下一步。 */
function CardNotes({ item, prior, hint }: { item: ErrorItem; prior: readonly ErrorItem[]; hint: string | undefined }): React.JSX.Element {
  const m = useMessages(FAILURE)
  const last = prior[prior.length - 1]
  return (
    <>
      {item.detail === undefined || item.detail === "" ? null : <p className="failcard__why">{item.detail}</p>}
      {last === undefined ? null : (
        <p className="failcard__note">
          {prior.length === 1 ? m.priorOnce : m.priorMany(prior.length)}
          {humanize(last.message).text}
        </p>
      )}
      {hint === undefined ? null : <p className="failcard__note">{hint}</p>}
    </>
  )
}

/** 这一轮停在这儿了。 */
export function FailCard({
  item,
  prior = [],
  onRetry,
}: {
  item: ErrorItem
  /** 同一轮里在它前面、被它吞掉的可恢复报错。 */
  prior?: readonly ErrorItem[]
  /** 把这一轮那句话原样再发一次。只挂在最后一轮、而且此刻能发的时候。 */
  onRetry?: (() => void) | undefined
}): React.JSX.Element {
  const m = useMessages(FAILURE)
  const [open, setOpen] = useState(false)
  const kind = failureKind(`${item.message}\n${item.detail ?? ""}`)
  const failure = humanize(item.message)
  const raw = [failure.detailed ? item.message : undefined, prior.length > 0 ? `${m.earlier}\n${priorText(prior)}` : undefined]
    .filter((part) => part !== undefined)
    .join("\n\n")
  return (
    <div className="failcard">
      <div className="failcard__head">
        <span className="failcard__icon">
          <AlertIcon size={14} />
        </span>
        <span className="failcard__title">{m.title[kind]}</span>
        {onRetry === undefined ? null : (
          <button type="button" className="btn btn--slim failcard__retry" onClick={onRetry} title={m.retryTip}>
            {m.retry}
          </button>
        )}
      </div>
      <p className="failcard__text">
        <LinkifiedText text={failure.text} />
      </p>
      <CardNotes item={item} prior={prior} hint={kind === "quota" || kind === "rate" ? m.hint[kind] : undefined} />
      {raw === "" ? null : <MoreToggle open={open} onToggle={() => { setOpen((v) => !v) }} />}
      {open && raw !== "" ? <pre className="error__raw">{raw}</pre> : null}
    </div>
  )
}

/** 转录区里的一条报错：它在这一轮里的位置（见 `error-plan.ts`）决定怎么画。 */
export interface ErrorContext {
  state?: SoftState
  prior?: readonly ErrorItem[]
  onRetry?: (() => void) | undefined
}

export function ErrorView({ item, context }: { item: ErrorItem; context?: ErrorContext | undefined }): React.JSX.Element | null {
  if (item.fatal) return <FailCard item={item} prior={context?.prior} onRetry={context?.onRetry} />
  return <SoftFailure item={item} state={context?.state} />
}

