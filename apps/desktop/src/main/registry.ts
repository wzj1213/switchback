import {
  createAcpDriver,
  createClaudeDriver,
  createCodexDriver,
  createDshDriver,
  createKimiDriver,
  grokCacheRead,
  grokContextUsed,
  grokOutputTokens,
  grokLogPath,
  grokModelChanged,
  grokNativeApproval,
  type EngineDriver,
  type ClaudeExecutable,
} from "@omni/engine"
import { readEngineFile, registerAcpEngines } from "./engines.js"
import type { Logger } from "./log.js"
import { BUILTIN_ENGINE_LABELS } from "../shared/builtin-engines.js"

/**
 * 这台机器上 omni 认哪些引擎。
 *
 * **驱动表就是真源**：界面上能选的引擎从这里来，不在渲染层写第二份。
 * 写两份的下场是下拉里列着一堆名字，选中直接报「未注册的引擎」——真出过。
 * 五家稳定的 id / 顺序 / 名字放在 `shared/builtin-engines.ts`，设置页要靠它画出
 * 尚未进入可见清单的 DSH；这里也复用那份名字，避免同一家在两处改出两个称呼。
 *
 * 从 `host.ts` 拆出来是行数闸门逼的，但边界本来就该有：
 * 那边是「宿主怎么起、事件怎么出去」，这里是「有哪些引擎可选」。
 */

/**
 * 内置五家。**内置的判据是「验过」，不是「听说过」**：
 *
 * - `claude` / `codex`：各有一个专门的驱动。
 * - `kimi`：走它自带的 `kimi web` REST + WebSocket API。
 *   会话、插话、审批、模型、历史都从同一扇公开入口出来；不再借 ACP 的
 *   `terminal/*` 让命令改由 omni 代跑。
 * - `grok`：同一个 ACP 驱动。它的子命令**不叫 acp**，叫 `grok agent stdio`
 *   ——这是它自带文档里写明的「Agent Mode (ACP) and IDE Integration」，
 *   同样不是猜的。记录路径见 `acp/grok.ts`。
 * - `dsh`：仍走通用 ACP 驱动，只启动 DSH 自己公开的 `--profile acp`。
 *   profile 由 DSH 管理；omni 不替它安装插件，也不拿 Web 内部控制面拼一条私有链路。
 *
 * 五家都有 `probe()`。前四家随宿主启动探测，没装就在下拉里标成「未安装」；
 * DSH 要先在设置中确认原生 provider、model 与凭证已经配好，确认前既不进清单也不起探测进程。
 * `engines.ts` 反对的是「列出没装的东西」和「把别人的参数抄进代码」——
 * 前者由 probe / 接入开关挡掉，后者在 kimi / grok / dsh 这里不成立
 *（那都是它们自己文档里的用法）。
 *
 * 其余 ACP 引擎（ZCode 之类）仍然只从 `engines.json` 读：
 * **这台机器上没装 zcode**，内置一条猜出来的命令行只会让人点了就崩。
 */
export function buildRegistry(
  userData: string,
  log: Logger,
  claudeExecutable: ClaudeExecutable = "bundled",
  dshProfile: () => string = () => "acp",
): { drivers: Readonly<Record<string, EngineDriver>>; labels: Readonly<Record<string, string>> } {
  const acp = registerAcpEngines(readEngineFile(userData, log))
  return {
    drivers: {
      claude: createClaudeDriver({ executable: claudeExecutable }),
      codex: createCodexDriver(),
      kimi: createKimiDriver(),
      grok: createAcpDriver({
        id: "grok",
        command: "grok",
        args: ["agent", "stdio"],
        logPath: grokLogPath,
        // 它不发 ACP 的 `usage_update`，用量在自己的私有通知里（见 `acp/grok.ts`）
        contextUsed: grokContextUsed,
        // 同一条 `turn_completed` 里的缓存命中（cachedReadTokens 是 inputTokens 的子集）
        cacheRead: grokCacheRead,
        // 同一条里的生成量。**token/s 的分子只能是它**，见 `Usage.outputTokens`
        outputTokens: grokOutputTokens,
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
      dsh: createDshDriver({ profile: dshProfile }),
      ...acp.drivers,
    },
    labels: {
      ...BUILTIN_ENGINE_LABELS,
      ...acp.labels,
    },
  }
}
