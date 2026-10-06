/**
 * ACP 注册表在主进程与设置页之间来回传的那几种形状。**只放类型**：
 * 解析在 `main/acp-registry-model.ts`，界面只拿结论去画。
 */

/** 这台机器上怎么起它。三种分发走法完全不同，界面要照实说出要执行 / 下载的东西。 */
export type LaunchPlan =
  | {
      kind: "npx" | "uvx"
      /** 真正会被执行的命令与参数（`npx -y <包@版本> …`）。 */
      command: string
      args: readonly string[]
      env?: Readonly<Record<string, string>>
      package: string
    }
  | {
      kind: "binary"
      /** 要下载的归档。注册表给了 sha256 就校验，对不上一字节都不解包。 */
      archive: string
      sha256?: string
      /** 归档里那个可执行文件的相对路径（注册表原样），如 `./goose`。 */
      cmd: string
      args: readonly string[]
      env?: Readonly<Record<string, string>>
    }

/** 注册表里的一家，给设置页画一行用。 */
export interface RegistryRow {
  id: string
  name: string
  version: string
  description?: string
  repository?: string
  website?: string
  license?: string
  authors: readonly string[]
  /** 这台机器上能怎么起。缺席时 `missing` 说清少了什么。 */
  plan?: LaunchPlan
  missing?: string
  /** 已经接进来了：engines.json 里那一条的键与版本；注册表更新就标 `update`。 */
  connected?: { name: string; version: string; update: boolean }
}

export interface RegistryView {
  rows: readonly RegistryRow[]
  /** 这份清单是什么时候从网上取的。离线时给的是缓存，人要知道它有多旧。 */
  fetchedAt?: number
  source: "network" | "cache" | "none"
  /** 取不到时那句话。有缓存就照样给清单，只是把这句一起摆出来。 */
  error?: string
}

/** 接入过程中的一步。下载有字节数，别的只报走到哪。 */
export interface ConnectProgress {
  agentId: string
  phase: "download" | "extract" | "trial" | "write"
  received?: number
  total?: number
}

/** 已经写进 engines.json 的一家第三方 ACP 引擎。 */
export interface AcpEngineRow {
  /** engines.json 里的键。 */
  name: string
  /** 界面上的引擎 id（带 `acp:` 前缀）。 */
  id: string
  label: string
  command: string
  args: readonly string[]
  /** 从注册表接进来的才有；手接的没有。 */
  source?: { id: string; version: string; kind: "npx" | "uvx" | "binary" }
  /** 此刻有没有会话正在用它。在用的那几家换版本、移除要等会话关掉。 */
  inUse: boolean
}

/** 试接回来的东西，原样给界面画（登录方式就在这里）。形状同 `@switchback/engine` 的 `AcpTrial`。 */
export interface AcpTrialView {
  ok: boolean
  protocolVersion?: number
  capabilities?: readonly string[]
  error?: string
  stderr?: string
  authMethods?: readonly AcpAuthMethodView[]
  logout?: boolean
  agent?: { name?: string; title?: string; version?: string }
}

/** 一种登录方式。形状同 `@switchback/engine` 的 `AcpAuthMethod`。 */
export interface AcpAuthMethodView {
  id: string
  name: string
  description?: string
  kind: "agent" | "terminal"
  args?: readonly string[]
  command?: string
  apiKey?: boolean
}

export interface ConnectResult {
  ok: boolean
  /** 成功时 engines.json 里的键与界面上的引擎 id。 */
  name?: string
  id?: string
  error?: string
  stderr?: string
  trial?: AcpTrialView
  /** 写进去了，但此刻有会话正在用旧的那份：等它们关掉才换上。 */
  pending?: boolean
}

export interface AcpLoginOutcome {
  ok: boolean
  error?: string
  stderr?: string
  /** terminal 型：已经在「终端」里打开了它自己的登录界面，结果要人回来点「试接」确认。 */
  terminal?: boolean
}
