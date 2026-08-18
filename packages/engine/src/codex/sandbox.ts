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

/**
 * ## 审批策略：**除了只读档，都让 codex 自己判**
 *
 * 原来这里钉死 `untrusted`——「把最多的请求路由给客户端」，也就是让 codex
 * 什么都问上来、再由 omni 的判定器裁决。听起来更安全，实际是这样：
 *
 * - 你在终端里跑 codex，同一条命令它自己就过了；在 omni 里却被拦下来问你。
 *   **同一个引擎、同一条命令、两种行为**，而 omni 的产品前提是「引擎原生」。
 * - 「引擎自动」这一档的界面原话是「**什么算安全由引擎自己判**」——
 *   而实现是 omni 判。界面说的话和代码做的事对不上，这本身就是 bug。
 * - 后果不是更安全，是更不安全：`zsh -lc '… | python3 -c …'` 这种日常命令
 *   每条都弹一张卡（静态判不出 → `unparseable-command` 红线），人一天点几十次，
 *   点到最后是**闭着眼睛点**——那时候真正该拦的那一张也一起过去了。
 *
 * 现在的分法，判据是「谁有资格决定问不问」：
 *
 * | 档位        | policy       | 谁在判                                              |
 * | ----------- | ------------ | --------------------------------------------------- |
 * | `read-only` | `untrusted`  | **omni**。只读是 omni 的承诺，它必须看见每一次动作才拒得住 |
 * | `auto-edit` | `on-request` | **引擎**。它想升权时才问；问上来的那些再过 omni 的判定与红线 |
 * | `full`      | `on-request` | 同上，但 omni 的 `full` 判定几乎都放行，所以你基本看不到卡  |
 *
 * `full` **不用 `never`**：那样 codex 连问都不问，一条被沙箱挡住的操作
 * 就只能直接失败，而不是「问一句然后放行」。少弹一张卡换来一次说不清的失败，不划算。
 *
 * 代价说明白：omni 看不见的动作，omni 的红线也管不住它。这一档的纵深从
 *「沙箱 + 引擎 + omni」变成「沙箱 + 引擎」——这是「引擎原生」这个前提的必然代价。
 */
export const POLICY: Readonly<Record<Trust, WireApprovalPolicy>> = {
  "read-only": "untrusted",
  "auto-edit": "on-request",
  full: "on-request",
}
