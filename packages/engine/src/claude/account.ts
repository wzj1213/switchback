import type { EngineAccount } from "@switchback/protocol"

interface NativeAccount {
  email?: unknown
  subscriptionType?: unknown
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined

/** Claude SDK `accountInfo()` 的公开身份字段 → Switchback 账号读数。 */
export function claudeAccount(raw: unknown): EngineAccount | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const account = raw as NativeAccount
  const label = text(account.email)
  if (label === undefined) return undefined
  const plan = text(account.subscriptionType)
  return { label, ...(plan === undefined ? {} : { plan }) }
}
