import type { EngineAxis, Trust } from "@switchback/protocol"
import { canonical, type CodexSettings } from "./settings.js"
import type { WireApprovalPolicy, WireApprovalsReviewer, WireSandbox } from "./wire.js"

/**
 * ## 沙箱不是标签，是真的沙箱——而且它就是「问不问」的开关
 *
 * 这是接第二家引擎最重要的一个发现，和 Claude 的结构完全不同。
 *
 * Claude 的 `permissionMode` 只是个路由开关，所以我们把它钉死在 `default`，
 * 让**每一次**调用都走 `canUseTool`，档位全部表达在 `@switchback/approval` 里。
 *
 * codex 不是。它的 `sandbox` 是操作系统级的真沙箱（macOS 上是 seatbelt），
 * 实测下来：**只有沙箱会拦的操作才会来问客户端**。
 * `workspace-write` 下往工作区里写文件根本不会触发审批——沙箱本来就允许，
 * codex 没有理由问；换成 `read-only`，同一次写就变成一条
 * `item/fileChange/requestApproval` 送到我们手上。
 *
 * 所以三个旋钮必须一起设，少一个都会把 Codex 原生档位改成另一件事：
 *
 * | Switchback 档位   | Codex 原生档      | sandbox / approval / reviewer                    |
 * | ----------- | ----------------- | ------------------------------------------------ |
 * | `read-only` | Read Only         | `read-only` / `on-request` / `user`               |
 * | `auto-edit` | Approve for me    | `workspace-write` / `on-request` / `auto_review`  |
 * | `full`      | Full Access       | `danger-full-access` / `never` / `user`           |
 *
 * 关键是中间那一列：只有 `on-request` 仍是 “Ask for approval”；再把 reviewer
 * 设成 `auto_review`，才是用户在 Codex 权限菜单里选的 “Approve for me”。
 * Switchback 不再用自己的静态规则冒充这位原生评审器。
 */
export const SANDBOX: Readonly<Record<Trust, WireSandbox>> = {
  "read-only": "read-only",
  "auto-edit": "workspace-write",
  full: "danger-full-access",
}

export const POLICY: Readonly<Record<Trust, WireApprovalPolicy>> = {
  "read-only": "on-request",
  "auto-edit": "on-request",
  full: "never",
}

export const REVIEWER: Readonly<Record<Trust, WireApprovalsReviewer>> = {
  "read-only": "user",
  "auto-edit": "auto_review",
  full: "user",
}

function axisOf(axis: string, got: string | undefined, want: string): EngineAxis | undefined {
  if (got === undefined) return undefined
  return { axis, id: got, match: canonical(got) === canonical(want) ? "aligned" : "diverged" }
}

/** 把 Codex 回报的三个原生旋钮逐项和用户所选档位对齐。 */
export function nativeAxes(settings: CodexSettings, trust: Trust): EngineAxis[] {
  return [
    axisOf("approval", settings.approval, POLICY[trust]),
    axisOf("reviewer", settings.reviewer, REVIEWER[trust]),
    axisOf("sandbox", settings.sandbox, SANDBOX[trust]),
  ].filter((axis) => axis !== undefined)
}

/**
 * 三档的原生旋钮都不同，跨档必须重开 app-server 才能真的生效。
 * reviewer 也算原生旋钮：漏比它，就会把 “Ask for approval” 假报成 “Approve for me”。
 */
export function nativeTrustDiffers(
  sandbox: WireSandbox,
  approval: WireApprovalPolicy,
  reviewer: WireApprovalsReviewer,
  trust: Trust,
): boolean {
  return (
    SANDBOX[trust] !== sandbox || POLICY[trust] !== approval || REVIEWER[trust] !== reviewer
  )
}
