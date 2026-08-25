export { createClaudeDriver } from "./claude/driver.js"
export type { ClaudeExecutable } from "./claude/executable.js"
export { createCodexDriver } from "./codex/driver.js"
export { createAcpDriver } from "./acp/driver.js"
export { createDshDriver, probeDshAcp } from "./acp/dsh.js"
export type {
  DshDriverOptions,
  DshCommandProbe,
  DshProfileCheck,
  DshProfileStatus,
} from "./acp/dsh.js"
export { createKimiDriver } from "./kimi/driver.js"
export { kimiLogPath, findInIndex as findKimiSession } from "./kimi/log.js"
export {
  grokLogPath,
  grokChatPath,
  grokWorkspaceDir,
  grokContextUsed,
  grokCacheRead,
  grokOutputTokens,
  grokNotice,
  grokNotification,
  grokModelChanged,
  grokNativeApproval,
} from "./acp/grok.js"
export { createGrokActivity } from "./acp/grok-activity.js"
export { grokHookItems, grokPromptMeta } from "./acp/grok-hooks.js"
export { grokScheduledTurn } from "./acp/grok-scheduled.js"
export { grokInteraction, grokInteractionResolved } from "./acp/grok-interaction.js"
export {
  modelsOf,
  modesOf,
  currentModeOf,
  startupMessage as acpStartupMessage,
} from "./acp/setup.js"
export { handlePermission, respond as respondPermission } from "./acp/permission.js"
export type { PermissionContext as AcpPermissionContext } from "./acp/permission.js"
export { createQueue } from "./queue.js"
export { probeCommand } from "./probe.js"
export { isWindows, lookupCommand, resolveLoginPath, tree } from "./platform.js"
export type { LoginPathDeps, TreeControl } from "./platform.js"
export type { Probe, ProbeState } from "./probe.js"
export { createProcessOwner, unpacked } from "./subprocess.js"
export {
  sanitize,
  forcesHumanPrompt,
  summarize,
  buildRequest,
  toAllow,
  toDeny,
} from "./claude/permission.js"
export { toolDetail, assistantItems, turnStatus } from "./claude/translate.js"
export { fileChangesOf } from "./claude/diff.js"
/** 合成 diff。Claude 与 ACP 三家共用——两边拿到的都是「改前 / 改后」两份全文。 */
export { synthDiff } from "./synth.js"
export { createRpc } from "./rpc.js"
export { handleNotification } from "./codex/notify.js"
export {
  itemToOmni,
  toToolCall,
  toolStatus,
  countDiff,
  isStreamingText,
  textOf,
} from "./codex/translate.js"
export {
  buildRequest as buildCodexRequest,
  summarize as summarizeCodex,
  decisionFor,
  toolOf,
} from "./codex/approve.js"
export { handleUpdate, createUpdateState, closeText, sweep } from "./acp/update.js"
export type { UpdateContext, UpdateState } from "./acp/update.js"
export {
  detailOf as acpDetailOf,
  toToolCall as acpToToolCall,
  toolStatusOf as acpToolStatus,
  toolNameOf as acpToolName,
  merge as acpMerge,
  stopStatus,
} from "./acp/translate.js"
export {
  pickOption,
  summarize as summarizeAcp,
  buildRequest as buildAcpRequest,
} from "./acp/approve.js"
export { pickMode } from "./acp/mode.js"
export type { AcpToolCall, AcpUpdate, AcpNewSession, AcpPermissionOption } from "./acp/wire.js"

export type {
  EngineDriver,
  EngineSession,
  StartRequest,
  NativeTurnStart,
  ApprovalAsk,
  ApprovalAnswer,
  InteractionWait,
  TrustChange,
} from "./contract.js"
export type { ClaudeDriverConfig } from "./claude/driver.js"
export type { CodexDriverConfig } from "./codex/driver.js"
export type { AcpDriverConfig } from "./acp/caps.js"
export type { KimiDriverConfig } from "./kimi/driver.js"
export type { AskMeta, RequestContext } from "./claude/permission.js"
export type { PushQueue } from "./queue.js"
export type {
  ProcessOwner,
  ReclaimConfig,
  ReclaimReport,
  Rung,
  SpawnRequest,
} from "./subprocess.js"
export type { RpcPeer, RpcHandlers, ServerCall, RequestId } from "./rpc.js"
export type { NotifyContext } from "./codex/notify.js"
export type { WireItem, WireApprovalRequest, WireSandbox } from "./codex/wire.js"
