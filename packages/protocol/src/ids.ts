/** 标识符与引擎身份。ID 一律由宿主铸造，本包不生成。 */

export type ThreadId = string
export type TurnId = string
export type ItemId = string

/**
 * 引擎身份。内置引擎用裸名，ACP 接入的第三方用 `acp:` 前缀。
 * 例：`codex` / `claude` / `acp:zcode` / `acp:kimi`
 */
export type EngineId = string

/** 引擎的接入方式——决定用哪个驱动，也决定能力上限。 */
export type EngineTransport =
  /** codex app-server --stdio，JSON-RPC 2.0 */
  | "codex-app-server"
  /** Claude Agent SDK，进程内驱动 */
  | "claude-sdk"
  /** 通用 ACP over stdio */
  | "acp-stdio"

export interface EngineDescriptor {
  id: EngineId
  /** 展示名，如「Codex」「Claude Code」「ZCode」 */
  label: string
  transport: EngineTransport
  /** 可执行文件与参数，由宿主 spawn */
  command: string
  args: readonly string[]
  /** 覆盖在「已擦洗凭据的父环境」之上的显式环境变量 */
  env?: Readonly<Record<string, string>>
}
