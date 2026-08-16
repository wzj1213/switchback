import type { Trust } from "@omni/protocol"
import type { WireApprovalPolicy, WireSandbox } from "./wire.js"

/**
 * ## 沙箱不是标签，是真的沙箱——而且它就是「问不问」的开关
 *
 * 这是接第二家引擎最重要的一个发现，和 Claude 的结构完全不同。
 *
 * Claude 的 `permissionMode` 只是个路由开关，所以我们把它钉死在 `default`，
 * 让**每一次**调用都走 `canUseTool`，档位全部表达在 `@omni/approval` 里。
 *
 * codex 不是。它的 `sandbox` 是操作系统级的真沙箱（macOS 上是 seatbelt），
 * 实测下来：**只有沙箱会拦的操作才会来问客户端**。
 * `workspace-write` 下往工作区里写文件根本不会触发审批——沙箱本来就允许，
 * codex 没有理由问；换成 `read-only`，同一次写就变成一条
 * `item/fileChange/requestApproval` 送到我们手上。
 *
 * 所以信任档**必须**落在 sandbox 上，落在 approvalPolicy 上是没用的：
 *
 * | 档位        | sandbox           | 结果                                             |
 * | ----------- | ----------------- | ------------------------------------------------ |
 * | `read-only` | `read-only`       | 任何写都来问 omni，omni 拒——档位真正生效         |
 * | `auto-edit` | `workspace-write` | 工作区内的写直接过；越界才问——正是这档的语义     |
 * | `full`      | `workspace-write` | 同上，越界时由 omni 的 `full` 判定放行           |
 *
 * `full` **不**升到 `danger-full-access`：那会把 OS 沙箱整个关掉。
 * `full` 的意思是「别拿日常操作烦我」，不是「把安全网撤了」——
 * 判定错了还有沙箱兜底，这层纵深不该为省一次弹窗而放弃。
 */
export const SANDBOX: Readonly<Record<Trust, WireSandbox>> = {
  "read-only": "read-only",
  "auto-edit": "workspace-write",
  full: "workspace-write",
}

/**
 * 沙箱谁更宽。数字大的放得更开。
 *
 * 用来判断改档位要不要出声：**往下调不用**（omni 自己拒得更多，
 * 多出来的那点沙箱权限永远用不到），往上调必须说——那时 omni 说可以、
 * 系统照样拦，而报错里看不出是沙箱干的。
 */
export const LOOSENESS: Readonly<Record<WireSandbox, number>> = {
  "read-only": 0,
  "workspace-write": 1,
  "danger-full-access": 2,
}

/** `untrusted` 把最多的请求路由给客户端，和 Claude 钉死 `default` 是同一个用意。 */
export const POLICY: WireApprovalPolicy = "untrusted"
