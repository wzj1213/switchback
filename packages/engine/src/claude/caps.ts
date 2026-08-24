import type { EngineCapabilities } from "@omni/protocol"
import { canAside } from "./aside.js"

/**
 * claude 这一家能做什么。**每一位都要有证据**，写在这儿而不是驱动里，
 * 理由和 ACP 的 `setup.ts` 的 `capabilitiesOf` 一样：能力表态是一件独立的事，
 * 它的凭据（实测、源码行号、版本）比代码本身长，摊在会话生命周期中间读不动。
 *
 * - `compact` 报 false：claude 自己的 `/compact` 已经在斜杠命令列表里，
 *   omni 再给一个就是同一件事出现两次。
 * - `steer` 报 false：SDK 没有「往正在跑的那一轮里插一句」的入口。宿主据此退回排队
 *   ——**不是假装支持再偷偷排队**，那样界面就没法如实告诉用户「这句得等」。
 * - `fork` 报 false：SDK 没有复制会话的入口，只能诚实地开空白分支。
 * - `modeReadback` 来自 `system/init` 与 `system/status` 的 `permissionMode`（见 `loop.ts`）。
 * - `sideQuestion` **运行时探测，不嗅版本**：0.3.231 的公开类型没声明它，
 *   所以只能问对象本身。
 * - `activity` 报 true 是**五家里唯一一个活体抓到过帧的**。`task_progress` 是公开类型，
 *   帧上那个 `workflow_progress` 数组不在公开类型里（至今没声明它），
 *   但 2026-08-19 真机十帧里四帧带着它——原文贴在 `tasks.ts` 的头注释里。
 *   **判据是「实测报得出来」，不是「源码里有」**：报 true 的后果是界面上多一个入口，
 *   而入口后面空着比没有入口更糟。
 */
export function capabilitiesOf(query: unknown): EngineCapabilities {
  return {
    compact: false,
    attachments: true,
    steer: false,
    fork: false,
    modeReadback: true,
    sideQuestion: canAside(query),
    activity: true,
  }
}
