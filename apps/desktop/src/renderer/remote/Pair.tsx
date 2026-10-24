import { useState } from "react"
import { DESK_SLOT, guessName, pair, rememberToken } from "@switchback/link"
import { useDocumentLocale } from "../i18n.js"
import { REMOTE_PAIR } from "./Pair.messages.js"

/**
 * 远程窗口的配对屏（`docs/远程模式方案.md` §2.3）。
 *
 * 和手机端那屏（`apps/web/src/screens/Pair.tsx`）是同一套流程：宿主上开一个八位码，
 * 这里换成长期令牌。差别只有两处：**令牌存在电脑端那一套键里**（`DESK_SLOT`），
 * 以及提示里说的是「配对电脑」——种类跟着码走，按手机开的码配上来只能看住与放行。
 *
 * 码错了和「现在根本没在配对」回的是同一句话（宿主那侧有意不分），所以这里也只有一句。
 */
export type PairReason = "fresh" | "expired" | "phone"


export function Pair({ reason }: { reason: PairReason }): React.JSX.Element {
  const m = REMOTE_PAIR[useDocumentLocale()]
  const [code, setCode] = useState("")
  const [name, setName] = useState(() => guessName(m.browser, DESK_SLOT))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = (event: { preventDefault: () => void }): void => {
    event.preventDefault()
    if (busy || code.trim().length < 8) return
    setBusy(true)
    setError("")
    void pair(code.trim(), name.trim())
      .then((result) => {
        if (!result.ok) {
          setError(result.reason)
          return
        }
        rememberToken(result.token, result.name, DESK_SLOT)
        // 重新走一遍启动：问「我是谁」、装桥、挂界面——和下次打开这页是同一条路
        window.location.reload()
      })
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : m.unreachable)
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <form className="remote-pair" onSubmit={submit}>
      <h1 className="remote-pair__title">Switchback</h1>
      <p className="remote-pair__hint">{m.hint[reason]}</p>
      <label className="remote-pair__label" htmlFor="remote-pair-code">{m.code}</label>
      <input
        id="remote-pair-code"
        className="remote-pair__code"
        value={code}
        onChange={(e) => {
          setCode(e.target.value.toUpperCase())
        }}
        autoComplete="off"
        spellCheck={false}
        maxLength={8}
        autoFocus
      />
      <label className="remote-pair__label" htmlFor="remote-pair-name">{m.name}</label>
      <input
        id="remote-pair-name"
        className="remote-pair__name"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
        }}
      />
      {error === "" ? null : <p className="remote-pair__error" role="alert">{error}</p>}
      <button type="submit" className="tbtn" disabled={busy || code.trim().length < 8}>
        {busy ? m.pairing : m.pair}
      </button>
    </form>
  )
}
