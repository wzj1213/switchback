import { describe, expect, it } from "vitest"
import { modeAxis, needsPermissionRestart, permissionOptions } from "./trust.js"

describe("Claude native trust", () => {
  it.each([
    ["只读", "read-only", { permissionMode: "plan" }],
    ["自动审批", "auto-edit", { permissionMode: "auto" }],
    [
      "完全访问",
      "full",
      { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true },
    ],
  ] as const)("%s 对齐 Claude 原生档", (_name, trust, expected) => {
    expect(permissionOptions(trust)).toEqual(expected)
  })

  it.each([
    ["普通会话进入完全访问要重启", false, "full", true],
    ["已启用 bypass 的会话可原地回到完全访问", true, "full", false],
    ["自动审批可原地切换", false, "auto-edit", false],
    ["只读可原地切换", false, "read-only", false],
  ] as const)("%s", (_name, bypassEnabled, trust, expected) => {
    expect(needsPermissionRestart(bypassEnabled, trust)).toBe(expected)
  })

  it("原生回报不是当前所选档时如实标 diverged", () => {
    expect(modeAxis("auto", "auto-edit").match).toBe("aligned")
    expect(modeAxis("default", "auto-edit")).toEqual({
      axis: "permission",
      id: "default",
      match: "diverged",
    })
  })
})
