import { decide, type Request as ApprovalRequest, type Rule, type Verdict } from "@switchback/approval"
import type { Trust } from "@switchback/protocol"
import { sanitize } from "../claude/permission.js"
import type { ApprovalAnswer, ApprovalAsk, StartRequest } from "../contract.js"
import type { ServerCall } from "../rpc.js"
import { localeOf } from "../locale.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { CODEX_PERMISSIONS } from "./permissions.messages.js"

export const PERMISSIONS_APPROVAL = "item/permissions/requestApproval"

interface WireFileSystemPermission {
  read?: unknown
  write?: unknown
  entries?: unknown
}

export interface WirePermissionsRequest {
  itemId?: unknown
  cwd?: unknown
  reason?: unknown
  permissions?: {
    network?: unknown
    fileSystem?: unknown
  }
}

export interface PermissionDeps {
  cwd: string
  home: string
  trust: () => Trust
  memory: () => readonly Rule[]
  askUser: StartRequest["askUser"]
  signal?: AbortSignal
  /** 适配器自己写的话用哪种语言（`StartRequest.locale`）。缺省中文。 */
  locale?: () => Locale
}

type Text = (typeof CODEX_PERMISSIONS)[Locale]

interface FileAccess {
  raw: WireFileSystemPermission
  read: string[]
  write: string[]
  concrete: string[]
}

interface FileBuckets {
  read: string[]
  write: string[]
  concrete: string[]
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry !== "") : []

function pathOf(raw: unknown): { label?: string; concrete?: string } {
  const path = record(raw)
  if (path?.["type"] === "path" && typeof path["path"] === "string") {
    return { label: path["path"], concrete: path["path"] }
  }
  if (path?.["type"] === "glob_pattern" && typeof path["pattern"] === "string") {
    return { label: `glob:${path["pattern"]}` }
  }
  const special = record(path?.["value"])
  return path?.["type"] === "special" && typeof special?.["kind"] === "string"
    ? { label: `special:${special["kind"]}` }
    : {}
}

function appendEntries(entries: unknown, buckets: FileBuckets): void {
  if (!Array.isArray(entries)) return
  for (const candidate of entries) {
    const entry = record(candidate)
    const access = entry?.["access"]
    if (access !== "read" && access !== "write") continue
    const path = pathOf(entry?.["path"])
    if (path.label !== undefined) (access === "write" ? buckets.write : buckets.read).push(path.label)
    if (path.concrete !== undefined) buckets.concrete.push(path.concrete)
  }
}

function fileAccess(raw: unknown): FileAccess | undefined {
  const fs = record(raw) as WireFileSystemPermission | undefined
  if (fs === undefined) return undefined
  const read = strings(fs.read)
  const write = strings(fs.write)
  const concrete = [...read, ...write]
  appendEntries(fs.entries, { read, write, concrete })
  return read.length === 0 && write.length === 0 ? undefined : { raw: fs, read, write, concrete }
}

function networkPermission(raw: unknown): Record<string, unknown> | undefined {
  const network = record(raw)
  return network?.["enabled"] === true ? network : undefined
}

const shown = (values: readonly string[], m: Text): string => m.shown(values.slice(0, 3).map(sanitize), values.length)

function permissionParts(params: WirePermissionsRequest, m: Text): string[] {
  const fs = fileAccess(params.permissions?.fileSystem)
  const parts: string[] = []
  if (networkPermission(params.permissions?.network) !== undefined) parts.push(m.network)
  if (fs !== undefined && fs.read.length > 0) parts.push(m.read(shown(fs.read, m)))
  if (fs !== undefined && fs.write.length > 0) parts.push(m.write(shown(fs.write, m)))
  return parts
}

function permissionReason(reason: unknown, m: Text): string {
  return typeof reason === "string" && reason !== "" ? m.reason(sanitize(reason)) : ""
}

export function permissionsSummary(params: WirePermissionsRequest, locale: Locale = DEFAULT_LOCALE): string {
  const m = CODEX_PERMISSIONS[locale]
  const parts = permissionParts(params, m)
  const base = parts.length === 0 ? m.noDetail : m.asks(parts)
  return `${base}${permissionReason(params.reason, m)}`
}

function permissionRequests(params: WirePermissionsRequest, cwd: string, locale: Locale): ApprovalRequest[] {
  const summary = permissionsSummary(params, locale)
  const requests: ApprovalRequest[] = []
  const fs = fileAccess(params.permissions?.fileSystem)
  if (fs !== undefined) {
    const tool = fs.write.length > 0 ? "apply_patch" : fs.concrete.length > 0 ? "read_file" : "codex_permissions"
    requests.push({ engine: "codex", tool, args: { paths: fs.concrete }, cwd, summary })
  }
  if (networkPermission(params.permissions?.network) !== undefined) {
    requests.push({ engine: "codex", tool: "WebFetch", args: {}, cwd, summary })
  }
  return requests
}

function strongest(verdicts: readonly Verdict[]): Verdict | undefined {
  return verdicts.find((verdict) => verdict.action === "deny")
    ?? verdicts.find((verdict) => verdict.action === "escalate")
    ?? verdicts[0]
}

function grantOf(params: WirePermissionsRequest): Record<string, unknown> {
  const network = networkPermission(params.permissions?.network)
  const fs = fileAccess(params.permissions?.fileSystem)
  return {
    ...(network === undefined ? {} : { network }),
    ...(fs === undefined ? {} : { fileSystem: fs.raw }),
  }
}

const response = (permissions: Record<string, unknown>, scope: "turn" | "session") => ({ permissions, scope })

function askedResponse(params: WirePermissionsRequest, answer: ApprovalAnswer): ReturnType<typeof response> {
  if (!answer.allow) return response({}, "turn")
  const scope = answer.remember === "once" ? "turn" : "session"
  return response(grantOf(params), scope)
}

function valueOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback
}

function approvalAsk(
  params: WirePermissionsRequest,
  requests: readonly ApprovalRequest[],
  verdict: Verdict,
  { itemId, locale }: { itemId: string; locale: Locale },
): ApprovalAsk {
  return {
    toolCallId: itemId,
    tool: requests.length === 1 ? requests[0]?.tool ?? "codex_permissions" : "codex_permissions",
    summary: permissionsSummary(params, locale),
    reason: verdict.reason,
    ...(verdict.redline === undefined ? {} : { redline: verdict.redline }),
    ...(verdict.suggest === undefined ? {} : { rememberHint: verdict.suggest.describe, suggest: verdict.suggest }),
  }
}

/** 权限 profile 请求不是工具审批；它用自己的 `{permissions, scope}` 必填形状。 */
export async function answerPermissions(call: ServerCall, deps: PermissionDeps): Promise<void> {
  const params = call.params as WirePermissionsRequest
  const itemId = valueOr(params.itemId, String(call.id))
  const cwd = valueOr(params.cwd, deps.cwd)
  const locale = localeOf(deps)
  const requests = permissionRequests(params, cwd, locale)
  if (requests.length === 0) {
    call.respond(response({}, "turn"))
    return
  }
  const verdict = strongest(requests.map((request) => decide(request, {
    trust: deps.trust(), worksite: deps.cwd, home: deps.home, memory: deps.memory(), locale,
  })))
  if (verdict?.action !== "escalate") {
    call.respond(response(verdict?.action === "allow" ? grantOf(params) : {}, "turn"))
    return
  }
  const ask = approvalAsk(params, requests, verdict, { itemId, locale })
  const answer = deps.signal === undefined
    ? await deps.askUser(ask)
    : await deps.askUser(ask, { signal: deps.signal })
  call.respond(askedResponse(params, answer))
}
