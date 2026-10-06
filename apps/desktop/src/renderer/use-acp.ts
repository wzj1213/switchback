import { useCallback, useEffect, useState } from "react"
import type { AcpAuthMethodView, AcpLoginOutcome, ConnectProgress, ConnectResult } from "../shared/acp-registry.js"
import { announceLoggedIn } from "./acp-login-signal.js"
import { bridge } from "./use-async.js"

/**
 * 接一家、登录一家——两件都要等很久（下载、npx 首次运行、浏览器里走 OAuth），
 * 所以都得有「在干什么」和「取消」。注册表那一行与已接那张卡共用这两个 hook：
 * 「升级」就是再接一次，不该是第二套状态机。
 */
export type ConnectState =
  | { phase: "idle" }
  | { phase: "confirm" }
  | { phase: "running"; step?: ConnectProgress }
  | { phase: "done"; result: ConnectResult }

export function useAcpConnect(agentId: string, onChanged: () => void): {
  state: ConnectState
  ask: () => void
  back: () => void
  start: () => void
  cancel: () => void
} {
  const switchback = bridge()
  const [state, setState] = useState<ConnectState>({ phase: "idle" })
  const running = state.phase === "running"
  useEffect(() => {
    if (!running || switchback === undefined) return undefined
    return switchback.onAcpProgress((step) => {
      // 结果先到、迟到的进度后到时不能把「完成」盖回「进行中」
      if (step.agentId === agentId) setState((previous) => (previous.phase === "running" ? { phase: "running", step } : previous))
    })
  }, [agentId, switchback, running])
  const start = useCallback(() => {
    if (switchback === undefined) return
    setState({ phase: "running" })
    void switchback.acpConnect(agentId).then(
      (result) => {
        setState({ phase: "done", result })
        if (result.ok) onChanged()
      },
      (error: unknown) => setState({ phase: "done", result: { ok: false, error: String(error) } }),
    )
  }, [agentId, switchback, onChanged])
  return {
    state,
    ask: () => setState({ phase: "confirm" }),
    back: () => setState({ phase: "idle" }),
    start,
    cancel: () => switchback?.acpCancel(`connect:${agentId}`),
  }
}

export interface LoginState {
  /** 正在办哪一种（agent 型会等浏览器那边走完）。 */
  busy?: string
  result?: AcpLoginOutcome & { method: string }
}

export function useAcpLogin(name: string): {
  state: LoginState
  login: (method: AcpAuthMethodView) => void
  logout: () => void
  cancel: () => void
} {
  const switchback = bridge()
  const [state, setState] = useState<LoginState>({})
  const run = (method: string, job: Promise<AcpLoginOutcome> | undefined, signIn: boolean): void => {
    if (job === undefined) return
    setState({ busy: method })
    void job.then(
      (outcome) => {
        setState({ result: { ...outcome, method } })
        // terminal 型只是「终端打开了」，还不知道登没登上，不能替它收横幅
        if (signIn && outcome.ok && outcome.terminal !== true) announceLoggedIn(`acp:${name}`)
      },
      (error: unknown) => setState({ result: { ok: false, error: String(error), method } }),
    )
  }
  return {
    state,
    login: (method) => run(method.name, switchback?.acpLogin({ name, methodId: method.id, kind: method.kind }), true),
    logout: () => run("退出登录", switchback?.acpLogout(name), false),
    cancel: () => switchback?.acpCancel(`login:${name}`),
  }
}

/** 进行中那一步给人看的一句。 */
export function stepText(step: ConnectProgress | undefined, sizeOf: (bytes: number) => string): string {
  if (step === undefined) return "准备中…"
  if (step.phase === "download") {
    if (step.received === undefined) return "开始下载…"
    return `下载中 ${sizeOf(step.received)}${step.total === undefined ? "" : ` / ${sizeOf(step.total)}`}`
  }
  if (step.phase === "extract") return "解包中…"
  if (step.phase === "trial") return "握手试接中…（npx / uvx 第一次运行要先下载，可能要一两分钟）"
  return "写进 engines.json…"
}
