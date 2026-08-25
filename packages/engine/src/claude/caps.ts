import type { EngineCapabilities } from "@omni/protocol"
import { canAside } from "./aside.js"

/**
 * claude 这一家能做什么。**每一位都要有证据**，写在这儿而不是驱动里，
 * 理由和 ACP 的 `setup.ts` 的 `capabilitiesOf` 一样：能力表态是一件独立的事，
 * 它的凭据（实测、源码行号、版本）比代码本身长，摊在会话生命周期中间读不动。
 *
 * - `compact` 报 false：claude 自己的 `/compact` 已经在斜杠命令列表里，
 *   omni 再给一个就是同一件事出现两次。
 * - `steer` 报 true：2026-08-25 在 SDK 0.3.231 / CLI 2.1.245 真跑
 *   `priority: "now"`，数数回答在 27 处停下，下一段只回了 `STEER_OK`。
 *   CLI 会为“被打断的阶段”和“插话后的阶段”各发一条 result，所以驱动必须把它们
 *   折成同一个 omni turn；`steer.live.test.ts` 同时钉“真叫停”和“只收工一次”。
 * - `fork` **报 true 了**（2026-08-25 接上，见 `fork.ts`）。原话是「SDK 没有复制会话的
 *   入口，只能诚实地开空白分支」，而 0.3.231 上 `resume` + `forkSession` +
 *   `resumeSessionAt` 三件套齐全，SDK 自己把这套叫 edit-and-retry——缺的从来不是入口，
 *   是接线。宿主给的「砍掉最后 N 轮」由驱动去读老会话的 jsonl，翻成一条 chain entry
 *   的 uuid；那次翻译是这条路上唯一会算错的地方（算错了只是少带或多带一轮上下文，
 *   界面上完全看不出来），所以它是纯函数、单独测，另有一条真跑的。
 * - **上下文窗口不是能力位，但同一类毛病**：`usageOf` 上面原来写着「窗口大小 SDK
 *   不给（它随模型变）」，于是 claude 会话里顶栏那条比例条、输入框那枚环、
 *   打靶靶纸上那圈有效区**一个都不出现**。实测 `getContextUsage()` 一直答得出来
 *   （`maxTokens`，opus-5[1m] 上是 1000000），只是没人问。见 `syncContext`
 *   与 `window.live.test.ts`。占用量现在同样取这条控制请求的 `totalTokens`，
 *   不能拿 result 的整轮汇总冒充当前窗口（见 `usage.ts`）。
 * - `modeReadback` 来自 `system/init` 与 `system/status` 的 `permissionMode`（见 `loop.ts`）。
 * - `sideQuestion` **运行时探测，不嗅版本**：0.3.231 的公开类型没声明它，
 *   所以只能问对象本身。
 * - `activity` 报 true 是因为 Claude 自己的活体帧证据完整。`task_progress` 是公开类型，
 *   帧上那个 `workflow_progress` 数组不在公开类型里（至今没声明它），
 *   但 2026-08-19 真机十帧里四帧带着它——原文贴在 `tasks.ts` 的头注释里。
 *   **判据是「实测报得出来」，不是「源码里有」**：报 true 的后果是界面上多一个入口，
 *   而入口后面空着比没有入口更糟。
 */
export function capabilitiesOf(query: unknown): EngineCapabilities {
  return {
    compact: false,
    attachments: true,
    steer: true,
    fork: true,
    modeReadback: true,
    sideQuestion: canAside(query),
    activity: true,
  }
}
