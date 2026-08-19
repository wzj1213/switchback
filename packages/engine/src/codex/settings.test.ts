import { describe, expect, it } from "vitest"
import { canonical, readSettings } from "./settings.js"

/**
 * 形状取自 codex 源码（`app-server-protocol/src/protocol/v2/thread.rs` 的
 * `ThreadSettingsUpdatedNotification` / `ThreadSettings`，@ f5a3dc554）。
 */
describe("codex 报的设置快照", () => {
  const REAL = {
    threadId: "cx-1",
    threadSettings: {
      cwd: "/w",
      approvalPolicy: "on-request",
      approvalsReviewer: "client",
      // **标签联合**，不是裸串：Rust 侧 #[serde(tag = "type", rename_all = "kebab-case")]
      sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: true },
      activePermissionProfile: null,
      model: "gpt-5.6-sol",
      modelProvider: "openai",
      effort: "high",
      collaborationMode: "default",
    },
  }

  it("取出 omni 关心的那四样", () => {
    expect(readSettings(REAL)).toEqual({
      approval: "on-request",
      sandbox: "workspaceWrite",
      model: "gpt-5.6-sol",
      effort: "high",
    })
  })

  it("**沙箱两种形状都认**：通知里是标签联合，而 omni 自己发出去的是裸串", () => {
    expect(readSettings({ threadSettings: { sandboxPolicy: "read-only" } }).sandbox).toBe("read-only")
    expect(readSettings({ threadSettings: { sandboxPolicy: { type: "read-only" } } }).sandbox).toBe("read-only")
  })

  it("没报的那一样就缺席——**不填一个默认值顶替**，那会让界面显示一个引擎没说过的档", () => {
    expect(readSettings({ threadSettings: { approvalPolicy: "untrusted" } })).toEqual({ approval: "untrusted" })
  })

  it("认不出的形状给空，不抛——协议一直在加字段", () => {
    expect(readSettings(undefined)).toEqual({})
    expect(readSettings({})).toEqual({})
    expect(readSettings({ threadSettings: { approvalPolicy: 42, sandboxPolicy: [] } })).toEqual({})
  })
})

/**
 * **实测逼出来的一步**：omni 发 `workspace-write`，codex 报 `workspaceWrite`。
 * 同一个值两种拼写，直接比字符串会给每条 codex 会话常亮一句「引擎那边不是 omni 切的」
 * ——而它就是 omni 切的。
 */
describe("比对用的规范形", () => {
  it("两种拼写归一", () => {
    expect(canonical("workspace-write")).toBe(canonical("workspaceWrite"))
    expect(canonical("read-only")).toBe(canonical("readOnly"))
    expect(canonical("danger-full-access")).toBe(canonical("dangerFullAccess"))
  })

  it("**不同的档仍然不同**——归一不能把该报警的也抹平", () => {
    expect(canonical("read-only")).not.toBe(canonical("workspace-write"))
    expect(canonical("untrusted")).not.toBe(canonical("on-request"))
  })
})
