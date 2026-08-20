import { describe, expect, it } from "vitest"
import { nativeTrustDiffers, POLICY, REVIEWER, SANDBOX } from "./sandbox.js"

describe("codex native trust", () => {
  it.each([
    ["同一档不重启", "auto-edit", "auto-edit", false],
    ["自动审批到完全访问要换沙箱与审批策略", "auto-edit", "full", true],
    ["完全访问回自动审批也要恢复沙箱与评审器", "full", "auto-edit", true],
    ["只读升自动要换原生沙箱", "read-only", "auto-edit", true],
    ["自动降只读也要换原生沙箱与策略", "auto-edit", "read-only", true],
  ] as const)("%s", (_name, from, to, expected) => {
    expect(nativeTrustDiffers(SANDBOX[from], POLICY[from], REVIEWER[from], to)).toBe(expected)
  })

  it.each([
    ["只读", "read-only", { sandbox: "read-only", policy: "on-request", reviewer: "user" }],
    ["自动审批", "auto-edit", { sandbox: "workspace-write", policy: "on-request", reviewer: "auto_review" }],
    ["完全访问", "full", { sandbox: "danger-full-access", policy: "never", reviewer: "user" }],
  ] as const)("%s 对齐 Codex 原生三旋钮", (_name, trust, expected) => {
    expect({ sandbox: SANDBOX[trust], policy: POLICY[trust], reviewer: REVIEWER[trust] }).toEqual(expected)
  })
})
