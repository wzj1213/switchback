import type { AcpTrialView } from "../../shared/acp-registry.js"
import { useAcpLogin, type LoginState } from "../use-acp.js"

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
  const methods = trial.authMethods ?? []
  if (methods.length === 0 && trial.logout !== true) {
    return <p className="acp-login__note">它没有报任何登录方式：要么不用登录，要么只能照它自己的文档在终端里登。</p>
  }
  const keyed = methods.some((method) => method.apiKey === true)
  return (
    <div className="acp-login">
      <div className="acp-login__row">
        <span className="acp-login__label">登录方式</span>
        {methods.map((method) => (
          <button
            key={method.id}
            type="button"
            className="tbtn"
            disabled={state.busy !== undefined}
            title={titleOf(method.description, method.kind)}
            onClick={() => {
              login(method)
            }}
          >
            {method.name}
            {method.kind === "terminal" ? <span className="acp-login__kind">终端</span> : null}
            {method.apiKey === true ? <span className="acp-login__kind">key</span> : null}
          </button>
        ))}
        {trial.logout === true ? (
          <button type="button" className="tbtn" disabled={state.busy !== undefined} onClick={logout}>
            退出登录
          </button>
        ) : null}
      </div>
      {keyed ? (
        <p className="acp-login__note">
          标着 key 的那种要 API key：Switchback 不代收密钥。它会从环境变量里读——写进 engines.json 这一条的 env，或者你的 shell 配置。
        </p>
      ) : null}
      <LoginResult state={state} onCancel={cancel} />
    </div>
  )
}

function titleOf(description: string | undefined, kind: "agent" | "terminal"): string {
  const how = kind === "terminal" ? "会在「终端」里打开它自己的登录界面" : "交给它自己办（通常会打开浏览器）"
  return description === undefined ? how : `${description}——${how}`
}

function LoginResult({ state, onCancel }: { state: LoginState; onCancel: () => void }): React.JSX.Element | null {
  if (state.busy !== undefined) {
    return (
      <p className="acp-login__note" role="status">
        正在办「{state.busy}」…浏览器那边走完它才会回话（最多等五分钟）。
        <button type="button" className="tbtn acp-login__cancel" onClick={onCancel}>取消</button>
      </p>
    )
  }
  const result = state.result
  if (result === undefined) return null
  if (result.ok) {
    return (
      <p className="acp-login__note acp-login__note--ok" role="status">
        {result.terminal === true
          ? `已在「终端」里打开「${result.method}」。在那边走完之后回来点「试接」确认。`
          : `「${result.method}」办完了。之后开的会话就是登录过的。`}
      </p>
    )
  }
  return (
    <>
      <p className="acp-login__note acp-login__note--error" role="alert">{result.error ?? "没办成。"}</p>
      {result.stderr === undefined ? null : <pre className="set__log">{result.stderr.slice(-1200)}</pre>}
    </>
  )
}

/** 试接的结论一句话，成功就接着摆登录方式。 */
export function TrialLine({ name, trial }: { name: string; trial: AcpTrialView }): React.JSX.Element {
  if (!trial.ok) {
    return (
      <>
        <p className="acp-card__note acp-card__note--error" role="alert">{trial.error ?? "试接失败。"}</p>
        {trial.stderr === undefined ? null : <pre className="set__log">{trial.stderr.slice(-1200)}</pre>}
      </>
    )
  }
  const who = [trial.protocolVersion === undefined ? undefined : `ACP v${String(trial.protocolVersion)}`,
    trial.agent === undefined ? undefined : [trial.agent.title ?? trial.agent.name, trial.agent.version].filter(Boolean).join(" ")]
    .filter((part) => part !== undefined && part !== "")
  return (
    <>
      <p className="acp-card__note acp-card__note--ok" role="status">
        握手成功{who.length === 0 ? "" : `（${who.join(" · ")}）`}。
        {(trial.capabilities ?? []).length === 0 ? "它没有声明额外能力。" : `它认领了：${(trial.capabilities ?? []).join("、")}。`}
      </p>
      <AcpLogin name={name} trial={trial} />
    </>
  )
}
