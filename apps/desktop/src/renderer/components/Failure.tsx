import { useState } from "react"
import { ChevronIcon } from "./icons.js"
import { humanize } from "../failure.js"

/**
 * 一条报错。**先说人话，原文折起来。**
 *
 * 引擎原样吐出来的东西是一堵墙（三层 JSON 包着一句话，或者一串
 * `result_type=user last_content_type=n/a` 这种给引擎作者排查用的字段）。
 * 但原文一个字都不能少——用户拿它去搜、去开 issue、去问引擎作者，
 * 那时候需要的恰恰是我们觉得没用的那部分。
 *
 * 所以：翻出来的那句在上面，原文在「详情」里。翻不动的（认不出的形状）
 * 就直接显示原文，连「详情」都不给——那时候原文**就是**人话，
 * 再套一层折叠只是多一次点击。
 */
export function Failure({ text, soft = false }: { text: string; soft?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const failure = humanize(text)
  const cls = soft ? "error--soft" : "error"

  if (!failure.detailed) return <div className={cls}>{failure.text}</div>

  return (
    <div className={cls}>
      <button
        type="button"
        className="error__row"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
        }}
      >
        <span className="error__text">{failure.text}</span>
        <span className="error__more">
          详情
          <ChevronIcon open={open} size={11} />
        </span>
      </button>
      {open ? <pre className="error__raw">{text}</pre> : null}
    </div>
  )
}
