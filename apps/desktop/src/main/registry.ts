import {
  createAcpDriver,
  createClaudeDriver,
  createCodexDriver,
  createKimiDriver,
  grokContextUsed,
  grokLogPath,
  grokModelChanged,
  grokNativeApproval,
  type EngineDriver,
} from "@omni/engine"
import { readEngineFile, registerAcpEngines } from "./engines.js"
import type { Logger } from "./log.js"

/**
 * 这台机器上 omni 认哪些引擎。
 *
 * **这张表就是真源**：界面上能选的引擎从这里来，不在渲染层写第二份。
 * 写两份的下场是下拉里列着一堆名字，选中直接报「未注册的引擎」——真出过。
 *
 * 从 `host.ts` 拆出来是行数闸门逼的，但边界本来就该有：
 * 那边是「宿主怎么起、事件怎么出去」，这里是「有哪些引擎可选」。
 */

/**
 * 内置四家。**内置的判据是「验过」，不是「听说过」**：
 *
 * - `claude` / `codex`：各有一个专门的驱动。
 * - `kimi`：走它自带的 `kimi web` REST + WebSocket API。
 *   会话、插话、审批、模型、历史都从同一扇公开入口出来；不再借 ACP 的
 *   `terminal/*` 让命令改由 omni 代跑。
 * - `grok`：同一个 ACP 驱动。它的子命令**不叫 acp**，叫 `grok agent stdio`
 *   ——这是它自带文档里写明的「Agent Mode (ACP) and IDE Integration」，
 *   同样不是猜的。记录路径见 `acp/grok.ts`。
 *
 * 四家都有 `probe()`，没装就在下拉里标成「未安装」并给一句能照着做的话。
 * `engines.ts` 反对的是「列出没装的东西」和「把别人的参数抄进代码」——
 * 前者由 probe 挡掉，后者在 kimi / grok 这里不成立（那都是它们自己文档里的用法）。
 *
 * 其余 ACP 引擎（ZCode 之类）仍然只从 `engines.json` 读：
 * **这台机器上没装 zcode**，内置一条猜出来的命令行只会让人点了就崩。
 */
export function buildRegistry(
  userData: string,
  log: Logger,
): { drivers: Readonly<Record<string, EngineDriver>>; labels: Readonly<Record<string, string>> } {
  const acp = registerAcpEngines(readEngineFile(userData, log))
  return {
    drivers: {
      claude: createClaudeDriver(),
      codex: createCodexDriver(),
      kimi: createKimiDriver(),
      grok: createAcpDriver({
        id: "grok",
        command: "grok",
        args: ["agent", "stdio"],
        logPath: grokLogPath,
        // 它不发 ACP 的 `usage_update`，用量在自己的私有通知里（见 `acp/grok.ts`）
        contextUsed: grokContextUsed,
        // Grok 1.0.5 的 ACP 用 `_meta.autoMode` 接分类器 Auto，
        // `_meta.yoloMode` 接 Always-approve；两枚都只在开场时设置。
        nativeApproval: grokNativeApproval,
        // **它确实会主动报档位变化**，所以这一位敢报 true：源码原话是
        // 「The agent emits `CurrentModeUpdate` on every entry and exit」
        //（grok-build `app/acp_handler/session_notification.rs`）。
        // kimi / zcode 没查到同样的实据，就按默认的 false——不知道别声称
        modeReadback: true,
        // 你在 grok 自己的界面里改了模型或强度，omni 靠这条跟上（见 `acp/grok.ts`）
        modelChanged: grokModelChanged,
      }),
      ...acp.drivers,
    },
    labels: {
      claude: "Claude Code",
      codex: "Codex",
      kimi: "Kimi Code",
      grok: "Grok",
      ...acp.labels,
    },
  }
}
