import type { AcpTrialView } from "../../shared/acp-registry.js"
import { useAcpLogin, type LoginState } from "../use-acp.js"
import type { Locale } from "@switchback/i18n"
import { useMessages } from "../i18n.js"
import { ACP_LOGIN } from "./AcpLogin.messages.js"

/**
 * 一家 ACP 引擎报出来的登录方式，一种一颗按钮。
 *
 * **只列它报的、按它报的顺序，不挑推荐**——那是它的事。Switchback 做的只是转达：
 * agent 型发一次 `authenticate`（它自己开浏览器、收回调、存凭证），
 * terminal 型在「终端」里跑它自己的登录界面。Switchback 看不到也存不了任何凭证。
 *
 * 要 API key 的那几种照实说 key 从哪儿来：Switchback 不代收密钥，
 * 它会从环境变量里读——写进 engines.json 这一条的 `env`，或者你的 shell 配置。
 */
export function AcpLogin({ name, trial }: { name: string; trial: AcpTrialView }): React.JSX.Element | null {
  const { state, login, logout, cancel } = useAcpLogin(name)
  const m = useMessages(ACP_LOGIN)
  const methods = trial.authMethods ?? []
  if (methods.length === 0 && trial.logout !== true) {
    return <p className="acp-login__note">{m.none}</p>
  }
  const keyed = methods.some((method) => method.apiKey === true)
  return (
    <div className="acp-login">
      <div className="acp-login__row">
        <span className="acp-login__label">{m.methods}</span>
        {methods.map((method) => (
          <button
            key={method.id}
            type="button"
            className="tbtn"
            disabled={state.busy !== undefined}
            title={titleOf(method.description, method.kind, m)}
            onClick={() => {
              login(method)
            }}
          >
            {method.name}
            {method.kind === "terminal" ? <span className="acp-login__kind">{m.terminal}</span> : null}
            {method.apiKey === true ? <span className="acp-login__kind">key</span> : null}
          </button>
        ))}
        {trial.logout === true ? (
          <button type="button" className="tbtn" disabled={state.busy !== undefined} onClick={logout}>
            {m.logout}
          </button>
        ) : null}
      </div>
      {keyed ? (
        <p className="acp-login__note">
          {m.keyNote}
        </p>
      ) : null}
      <LoginResult state={state} onCancel={cancel} />
    </div>
  )
}

function titleOf(description: string | undefined, kind: "agent" | "terminal", m: (typeof ACP_LOGIN)[Locale]): string {
  const how = kind === "terminal" ? m.howTerminal : m.howAgent
  return description === undefined ? how : m.titleWith(description, how)
}

function LoginResult({ state, onCancel }: { state: LoginState; onCancel: () => void }): React.JSX.Element | null {
  const m = useMessages(ACP_LOGIN)
  if (state.busy !== undefined) {
    return (
      <p className="acp-login__note" role="status">
        {m.busy(state.busy)}
        <button type="button" className="tbtn acp-login__cancel" onClick={onCancel}>{m.cancel}</button>
      </p>
    )
  }
  const result = state.result
  if (result === undefined) return null
  if (result.ok) {
    return (
      <p className="acp-login__note acp-login__note--ok" role="status">
        {result.terminal === true
          ? m.terminalOpened(result.method)
          : m.done(result.method)}
      </p>
    )
  }
  return (
    <>
      <p className="acp-login__note acp-login__note--error" role="alert">{result.error ?? m.failed}</p>
      {result.stderr === undefined ? null : <pre className="set__log">{result.stderr.slice(-1200)}</pre>}
    </>
  )
}

/** 试接的结论一句话，成功就接着摆登录方式。 */
export function TrialLine({ name, trial }: { name: string; trial: AcpTrialView }): React.JSX.Element {
  const m = useMessages(ACP_LOGIN)
  if (!trial.ok) {
    return (
      <>
        <p className="acp-card__note acp-card__note--error" role="alert">{trial.error ?? m.trialFailed}</p>
        {trial.stderr === undefined ? null : <pre className="set__log">{trial.stderr.slice(-1200)}</pre>}
      </>
    )
  }
  const who = [trial.protocolVersion === undefined ? undefined : `ACP v${String(trial.protocolVersion)}`,
    trial.agent === undefined ? undefined : [trial.agent.title ?? trial.agent.name, trial.agent.version].filter(Boolean).join(" ")]
    .filter((part): part is string => part !== undefined && part !== "")
  return (
    <>
      <p className="acp-card__note acp-card__note--ok" role="status">
        {m.ok(who)}
        {(trial.capabilities ?? []).length === 0 ? m.noCaps : m.caps(trial.capabilities ?? [])}
      </p>
      <AcpLogin name={name} trial={trial} />
    </>
  )
}
