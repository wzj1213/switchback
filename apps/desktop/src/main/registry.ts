import {
  createAcpDriver,
  createClaudeDriver,
  createCodexDriver,
  createDshDriver,
  createKimiDriver,
  grokCacheRead,
  createGrokActivity,
  grokContextUsed,
  grokOutputTokens,
  grokHookItems,
  grokInteraction,
  grokInteractionResolved,
  grokLogPath,
  grokNotice,
  grokNotification,
  grokPromptMeta,
  grokScheduledTurn,
  grokModelChanged,
  grokNativeApproval,
  grokFork,
  grokSteer,
  type EngineDriver,
  type ClaudeExecutable,
} from "@switchback/engine"
import { acpShapes, mergeAcpEngines, readEngineFile, registerAcpEngines, type AcpReload } from "./engines.js"
import type { Logger } from "./log.js"
import { BUILTIN_ENGINE_LABELS } from "../shared/builtin-engines.js"

/**
 * 这台机器上 Switchback 认哪些引擎。
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
 *   `terminal/*` 让命令改由 Switchback 代跑。
 * - `grok`：同一个 ACP 驱动。它的子命令**不叫 acp**，叫 `grok agent stdio`
 *   ——这是它自带文档里写明的「Agent Mode (ACP) and IDE Integration」，
 *   同样不是猜的。记录路径见 `acp/grok.ts`。
 * - `dsh`：仍走通用 ACP 驱动，只启动 DSH 自己公开的 `--profile acp`。
 *   profile 由 DSH 管理；Switchback 不替它安装插件，也不拿 Web 内部控制面拼一条私有链路。
 *
 * 五家都有 `probe()`。前四家随宿主启动探测，没装就在下拉里标成「未安装」；
 * DSH 要先在设置中确认原生 provider、model 与凭证已经配好，确认前既不进清单也不起探测进程。
 * `engines.ts` 反对的是「列出没装的东西」和「把别人的参数抄进代码」——
 * 前者由 probe / 接入开关挡掉，后者在 kimi / grok / dsh 这里不成立
 *（那都是它们自己文档里的用法）。
 *
 * 其余 ACP 引擎（ZCode 之类）仍然只从 `engines.json` 读：安装位置、启动参数和环境变量
 * 都属于这台机器，内置一条猜出来的命令行只会让另一台机器上的人点了就崩。
 */
export function buildRegistry(
  userData: string,
  log: Logger,
  claudeExecutable: ClaudeExecutable = "bundled",
  dshProfile: () => string = () => "acp",
): {
  drivers: Readonly<Record<string, EngineDriver>>
  labels: Readonly<Record<string, string>>
  /**
   * 重读 `engines.json`，把变化接进来：新增的立刻加，改过的与删掉的**只在没有会话在用时**
   * 才动——理由见 `engines.ts` 的 `mergeAcpEngines`。
   *
   * 敢在运行期加是因为宿主**用的时候**才读 `deps.drivers[id]`，从不快照；
   * 所以这两个对象是**故意可变**的（`Readonly` 只是不让外面写）。
   * 上一版没有这条路，于是往注册表里加一家之后唯一的出路是重启应用。
   */
  reload: (inUse?: (id: string) => boolean) => AcpReload
} {
  const file = readEngineFile(userData, log)
  const acp = registerAcpEngines(file)
  const known = acpShapes(file)
  const built = {
    drivers: {
      claude: createClaudeDriver({ executable: claudeExecutable }),
      codex: createCodexDriver(),
      kimi: createKimiDriver(),
      grok: createAcpDriver({
        id: "grok",
        label: BUILTIN_ENGINE_LABELS.grok,
        command: "grok",
        args: ["agent", "stdio"],
        logPath: grokLogPath,
        // 它不发 ACP 的 `usage_update`，用量在自己的私有通知里（见 `acp/grok.ts`）
        contextUsed: grokContextUsed,
        // 同一条 `turn_completed` 里的缓存命中（cachedReadTokens 是 inputTokens 的子集）
        cacheRead: grokCacheRead,
        // 同一条里的生成量。**token/s 的分子只能是它**，见 `Usage.outputTokens`
        outputTokens: grokOutputTokens,
        activity: createGrokActivity,
        // 图片被丢弃或压缩降级时，照 Grok 首方 UI 的规则保留原生提示
        notice: grokNotice,
        // 模型失效发生在开场或提示阶段，属于会话级警告，不能硬塞进某一轮正文
        notification: grokNotification,
        // Grok 已收口的 HookExecution 对齐其他引擎的 hook/* 工具项
        toolItems: grokHookItems,
        // 首方公开的回显关联位，防止迟到 stop Hook 串到下一轮；不进入模型上下文
        promptMeta: grokPromptMeta,
        // 前台循环到点后由 Grok 明确指定当前 ACP driver 发起下一轮；忙时通用驱动排队。
        nativeTurn: grokScheduledTurn,
        // Grok 的提问与计划审批是会阻塞工具的原生 reverse-request；回答只走 RPC 回包。
        interaction: grokInteraction,
        // 多个原生客户端共享会话时 first-answer-wins，别处先答就撤掉本地问题卡。
        interactionResolved: grokInteractionResolved,
        // Grok 1.0.5 的 ACP 用 `_meta.autoMode` 接分类器 Auto，
        // `_meta.yoloMode` 接 Always-approve；两枚都只在开场时设置。
        nativeApproval: grokNativeApproval,
        // 首方 Agent Mode 的 wire 扩展；1.0.5 真机验证过完整 fork→load 与 mid-turn interject。
        fork: grokFork,
        steerCall: grokSteer,
        // **它确实会主动报档位变化**，所以这一位敢报 true：源码原话是
        // 「The agent emits `CurrentModeUpdate` on every entry and exit」
        //（grok-build `app/acp_handler/session_notification.rs`）。
        // kimi / zcode 没查到同样的实据，就按默认的 false——不知道别声称
        modeReadback: true,
        // 你在 grok 自己的界面里改了模型或强度，Switchback 靠这条跟上（见 `acp/grok.ts`）
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
  return {
    ...built,
    reload: (inUse) => {
      const next = mergeAcpEngines(built, known, readEngineFile(userData, log), inUse)
      logReload(log, next)
      return next
    },
  }
}

/** 每一拨各记一行：「已经生效」和「看见了但这一次没生效」在日志里也得分得开。 */
function logReload(log: Logger, next: AcpReload): void {
  if (next.added.length > 0) log.write("info", "engines", `接入了 ${next.added.join("、")}`)
  if (next.replaced.length > 0) log.write("info", "engines", `换上了新配置：${next.replaced.join("、")}`)
  if (next.removed.length > 0) log.write("info", "engines", `摘掉了 ${next.removed.join("、")}`)
  if (next.needsRestart.length > 0)
    log.write("info", "engines", `${next.needsRestart.join("、")} 改过或已删除，但有会话在用，等它们关掉或重启才生效`)
}
