import { ipcRenderer } from "electron"
import type {
  AcpEngineRow,
  AcpLoginOutcome,
  AcpTrialView,
  ConnectProgress,
  ConnectResult,
  RegistryView,
} from "../shared/acp-registry.js"

/**
 * 「安装与接入」页 ACP 那几块用的通道。拆出来是行数闸门逼的，但边界也对：
 * 这几条只往主进程递**名字**（注册表 id、engines.json 的键、登录方式 id），
 * 要执行的东西一律由主进程现取——见 `main/acp-channels.ts`。
 */
export const acpBridge = {
  /** 注册表清单。`force` 是人点了「刷新」：哪怕本机那份还新鲜也去取。 */
  async acpRegistry(force?: boolean): Promise<RegistryView> {
    return (await ipcRenderer.invoke("switchback:acpRegistry", force)) as RegistryView
  },
  /** 接一家（已经接过就是升级）。进度走 `onAcpProgress`。 */
  async acpConnect(agentId: string): Promise<ConnectResult> {
    return (await ipcRenderer.invoke("switchback:acpConnect", agentId)) as ConnectResult
  },
  /** 已经写进 engines.json 的那几家。 */
  async acpEngines(): Promise<readonly AcpEngineRow[]> {
    return (await ipcRenderer.invoke("switchback:acpEngines")) as readonly AcpEngineRow[]
  },
  async acpEngineTry(name: string): Promise<AcpTrialView> {
    return (await ipcRenderer.invoke("switchback:acpEngineTry", name)) as AcpTrialView
  },
  async acpLogin(req: { name: string; methodId: string; kind: "agent" | "terminal" }): Promise<AcpLoginOutcome> {
    return (await ipcRenderer.invoke("switchback:acpLogin", req)) as AcpLoginOutcome
  },
  async acpLogout(name: string): Promise<AcpLoginOutcome> {
    return (await ipcRenderer.invoke("switchback:acpLogout", name)) as AcpLoginOutcome
  },
  async acpEngineRemove(name: string): Promise<{ ok: boolean; error?: string; pending?: boolean }> {
    return (await ipcRenderer.invoke("switchback:acpEngineRemove", name)) as { ok: boolean; error?: string; pending?: boolean }
  },
  /** 取消一件还在等的事：`connect:<注册表 id>` 或 `login:<engines.json 的键>`。 */
  acpCancel(key: string): void {
    void ipcRenderer.invoke("switchback:acpCancel", key)
  },
  onAcpProgress(handler: (step: ConnectProgress) => void): () => void {
    const listener = (_event: unknown, step: ConnectProgress): void => {
      handler(step)
    }
    ipcRenderer.on("switchback:acpProgress", listener)
    return () => {
      ipcRenderer.off("switchback:acpProgress", listener)
    }
  },
}
