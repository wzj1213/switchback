import type { EngineCapabilities } from "@omni/protocol"
import { canAside } from "./aside.js"

/**
 * claude 这一家能做什么。**每一位都要有证据**，写在这儿而不是驱动里，
 * 理由和 ACP 的 `setup.ts` 的 `capabilitiesOf` 一样：能力表态是一件独立的事，
 * 它的凭据（实测、源码行号、版本）比代码本身长，摊在会话生命周期中间读不动。
 *
 * - `compact` 报 false：claude 自己的 `/compact` 已经在斜杠命令列表里，
 *   omni 再给一个就是同一件事出现两次。
 * - `steer` 报 false：**这一位是真的做不到，而且是跑出来的**（`steer.live.test.ts`）。
 *   原来的理由「SDK 没有插一句的入口」不够准：0.3.231 的 `SDKUserMessage` 上有
 *   `priority?: 'now' | 'next' | 'later'`，看着就是那个入口。但那个字段在 `sdk.d.ts` 里
 *   一行注释都没有，`sdk.mjs` 里也没有处理它的代码——SDK 只是把消息转给 CLI 二进制。
 *
 *   于是真跑了一次（CLI 2.1.245）：让它数到 400，1.2 秒后推一条
 *   `priority: "now"` 的「停，别数了」进去。**它一路数到了 400**，一个字都没听。
 *   `turn.completed` 恰好一次、轮次 id 也对——也就是说那句话既没插进这一轮，
 *   也没另开一轮，omni 这边完全看不见它。
 *
 *   所以结论仍然是 false，但**理由换了**：入口存在，只是这一版的 CLI 不按 omni
 *   需要的语义兑现它。宿主据此退回排队——**不是假装支持再偷偷排队**，
 *   那样界面就没法如实告诉用户「这句得等」。那条 live 测试同时是哨兵：
 *   哪天 CLI 开始认这个字段，它会红，那时才轮到把这一位翻过来。
 * - `fork` **报 true 了**（2026-08-25 接上，见 `fork.ts`）。原话是「SDK 没有复制会话的
 *   入口，只能诚实地开空白分支」，而 0.3.231 上 `resume` + `forkSession` +
 *   `resumeSessionAt` 三件套齐全，SDK 自己把这套叫 edit-and-retry——缺的从来不是入口，
 *   是接线。宿主给的「砍掉最后 N 轮」由驱动去读老会话的 jsonl，翻成一条 chain entry
 *   的 uuid；那次翻译是这条路上唯一会算错的地方（算错了只是少带或多带一轮上下文，
 *   界面上完全看不出来），所以它是纯函数、单独测，另有一条真跑的。
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
    fork: true,
    modeReadback: true,
    sideQuestion: canAside(query),
    activity: true,
  }
}
