import { useState } from "react"
import { guessName, pair, rememberToken } from "@switchback/link"

/**
 * 配对屏。
 *
 * 桌面端「设置 → 远程访问」里点一下会显示一个八位码，五分钟有效、用一次作废。
 * 这里把它换成一个**长期设备令牌**，之后这台设备就不用再输了。
 *
 * 码错了和「现在根本没在配对」回的是同一句话——分开说等于告诉对方
 * 「现在有码可试」。所以这屏上的提示也只有一句。
 */
export function Pair({ onPaired, expired }: { onPaired: (token: string) => void; expired: boolean }): React.JSX.Element {
  const [code, setCode] = useState("")
  const [name, setName] = useState(guessName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = (event: React.FormEvent): void => {
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
        rememberToken(result.token, result.name)
        onPaired(result.token)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "连不上 Switchback")
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <form className="pair" onSubmit={submit}>
      <h1 className="pair__title">Switchback</h1>
      <p className="pair__hint">
        {expired
          ? "这台设备的授权已经不在了（被吊销，或者 Switchback 换了机器）。重新配一次。"
          : "在桌面上打开「设置 → 远程访问」，点「配对新设备」，把那八位码输进来。"}
      </p>
      <label className="pair__label" htmlFor="code">
        配对码
      </label>
      <input
        id="code"
        className="pair__code"
        value={code}
        onChange={(e) => {
          setCode(e.target.value.toUpperCase())
        }}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        maxLength={8}
        placeholder="XXXXXXXX"
        aria-describedby={error === "" ? undefined : "pair-error"}
      />
      <label className="pair__label" htmlFor="name">
        这台设备叫什么
      </label>
      <input
        id="name"
        className="pair__name"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
        }}
        maxLength={60}
        placeholder="iPhone"
      />
      {error === "" ? null : (
        <p className="pair__error" id="pair-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn--primary pair__go" type="submit" disabled={busy || code.trim().length < 8}>
        {busy ? "正在配对…" : "配对"}
      </button>
      <p className="pair__note">
        配好之后，这台设备能做的事有上限——具体到哪一档由桌面上的「远程档位上限」决定。
        丢了设备就在桌面上吊销它。
      </p>
    </form>
  )
}
