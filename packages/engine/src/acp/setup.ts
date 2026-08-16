import type { EngineCapabilities, EngineThread, ModelOption } from "@omni/protocol"
import type { AcpConfigOption, AcpInitialize, AcpModel, AcpNewSession, AcpSessionRow } from "./wire.js"

/**
 * 开会话时要从 `session/new` 的结果里挖出来的东西。
 *
 * 单独一个文件的理由：这些全是纯函数，**不用起进程就能测**，
 * 而它们要处理的恰恰是最容易出错的一块——同一个适配器不同版本报的字段名不一样。
 */

/**
 * 有的 ACP 适配器把推理强度**编进 modelId 里**（实测 codex 适配器：
 * `gpt-5.6-sol[low]`、`…[xhigh]`），那时没有独立的 effort 字段，
 * 这里也就不报 `efforts`——报了界面上会多出一个点了没用的强度选择器。
 *
 * 但**不是所有家都这样**：kimi 有一个独立的 `configOptions[id="thinking"]`
 *（low / high / max）。那种情况由 `effortsOf` 补上，见下。
 */
function toModelOption(raw: AcpModel): ModelOption {
  const id = raw.modelId ?? ""
  return {
    id,
    label: raw.name ?? id,
    ...(raw.description === undefined || raw.description === null ? {} : { description: raw.description }),
  }
}

function fromConfigOption(option: AcpConfigOption | undefined): readonly ModelOption[] {
  const current = typeof option?.currentValue === "string" ? option.currentValue : undefined
  return (option?.options ?? [])
    .filter((o): o is { value: string; name?: string; description?: string | null } => typeof o.value === "string")
    .map((o) => ({
      id: o.value,
      label: o.name ?? o.value,
      ...(o.description === undefined || o.description === null ? {} : { description: o.description }),
      // **agent 当前用的那个要标出来。** 不标的话界面退回列表第一个，
      // 于是面板上写着「K2.7 Coding」而引擎其实在跑 K3——一个安静的谎
      ...(o.value === current ? { isDefault: true } : {}),
    }))
}

/**
 * 模型清单。
 *
 * **两条路都要走。** 实测同一个 codex 适配器的两个版本：1.3.0 报
 * `models.availableModels`，0.16.0 报 `configOptions[id="model"]`。
 * 只认一条，另一个版本的用户就一个模型都选不出来。
 */
export function modelsOf(session: AcpNewSession): readonly ModelOption[] {
  const direct = session.models?.availableModels
  if (direct !== undefined && direct.length > 0) {
    const current = session.models?.currentModelId
    return direct.map((m) => {
      const option = toModelOption(m)
      return option.id === current ? { ...option, isDefault: true } : option
    })
  }
  return fromConfigOption(session.configOptions?.find((o) => o.id === "model"))
}

/** 档位清单同理：新版报 `modes`，旧版只在 `configOptions[id="mode"]` 里有。 */
export function modesOf(session: AcpNewSession): readonly { id?: string; name?: string }[] {
  const direct = session.modes?.availableModes
  if (direct !== undefined && direct.length > 0) return direct
  return fromConfigOption(session.configOptions?.find((o) => o.id === "mode")).map((o) => ({
    id: o.id,
    name: o.label,
  }))
}

/** 当前档位。同样两处都看——旧版只在 `configOptions` 里有 `currentValue`。 */
export function currentModeOf(session: AcpNewSession): string | undefined {
  const direct = session.modes?.currentModeId
  if (direct !== undefined) return direct
  const value = session.configOptions?.find((o) => o.id === "mode")?.currentValue
  return typeof value === "string" ? value : undefined
}

/**
 * 把起进程的失败翻成人能照着做的一句话。
 *
 * `Error: spawn zcode ENOENT` 对用户毫无意义——他要知道的是「装了没」「装哪了」。
 */
export function startupMessage(command: string, error: Error): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === "ENOENT") {
    return `找不到可执行文件 \`${command}\`。请确认这个 ACP 适配器已安装且在 PATH 上（终端里跑 \`which ${command}\` 验证）。`
  }
  if (code === "EACCES") return `没有权限执行 \`${command}\`。`
  return `启动 \`${command}\` 失败：${error.message}`
}

/**
 * 推理强度。
 *
 * ACP 没有为它定字段，但**有的适配器用一个 `configOptions` 表达它**——
 * 实测 kimi 是 `id="thinking"` / `category="thought_level"`，三档 low/high/max。
 *
 * 认 `category` 优先于认 `id`：`id` 是各家自己起的名字（谁都可能叫 `reasoning`），
 * 而 `category` 是 ACP 那边约定的语义位。
 *
 * **是会话级的、不是每个模型一份**，所以挂到每个模型上都是同一份——
 * 这不是偷懒：kimi 那边确实是「换模型不换 thinking 档」。
 */
export function effortsOf(session: AcpNewSession): { efforts: readonly string[]; current?: string } | undefined {
  const option = session.configOptions?.find(
    (o) => o.category === "thought_level" || o.id === "thinking" || o.id === "effort",
  )
  const efforts = (option?.options ?? [])
    .map((o) => o.value)
    .filter((v): v is string => typeof v === "string")
  if (efforts.length === 0) return undefined
  const current = typeof option?.currentValue === "string" ? option.currentValue : undefined
  return { efforts, ...(current === undefined ? {} : { current }) }
}

/**
 * agent 自己声明的能力 → omni 的能力位。
 *
 * **绝不写死。** 上一版整个 ACP 驱动一律报 `NO_CAPABILITIES`，于是就算 agent
 * 支持贴图、支持原生分叉，界面上那些入口一个都不给。ACP 的全部意义是
 * 「一个驱动接所有讲这个协议的引擎」，而各家能力本来就不一样——
 * 那就只能一家一家问，不能替它们回答。
 *
 * `sessionCapabilities` 用**空对象当标记**（实测 kimi 报 `{fork:{}}`），
 * 所以判据是键在不在，不是值是不是 true。
 */
export function capabilitiesOf(info: AcpInitialize | undefined): EngineCapabilities {
  const agent = info?.agentCapabilities
  const session = agent?.sessionCapabilities ?? {}
  return {
    // ACP 没有压缩上下文的方法（实测 kimi：`session/compact` → Method not found）
    compact: false,
    attachments: agent?.promptCapabilities?.image === true,
    // ACP 没有「往正在跑的那一轮里插一句」的入口
    steer: false,
    fork: "fork" in session,
  }
}

/** agent 支不支持列历史会话。 */
export function canList(info: AcpInitialize | undefined): boolean {
  return "list" in (info?.agentCapabilities?.sessionCapabilities ?? {})
}

/**
 * `session/list` 的结果 → omni 的形状。
 *
 * 和 codex / Claude 那两条一样的规矩：**没有句柄或没有工作区的不给列**。
 * 句柄缺了接不过来，工作区缺了工作区边界就错了——实测 kimi 的清单里
 * 确实有 `cwd: ""` 的历史条目（更早版本留下的）。
 */
export function sessionsOf(raw: unknown, max: number): readonly EngineThread[] {
  const rows = (raw as { sessions?: readonly AcpSessionRow[] } | undefined)?.sessions ?? []
  return rows
    .map(toEngineThread)
    .filter((t): t is EngineThread => t !== undefined)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max)
}

/** 一行 → 一条会话。缺句柄或缺工作区就作废（理由见 `sessionsOf`）。 */
function toEngineThread(row: AcpSessionRow): EngineThread | undefined {
  const handle = row.sessionId ?? ""
  const cwd = row.cwd ?? ""
  if (handle === "" || cwd === "") return undefined
  const title = (row.title ?? "").trim()
  return {
    handle,
    title: title === "" ? "（没有标题）" : title,
    cwd,
    updatedAt: timeOf(row.updatedAt),
  }
}

/** ISO 字符串 → 毫秒。认不出给 0，排序时沉到最后——**不要编一个「现在」**，
 *  那会让一条没有时间的历史莫名其妙排到最前面。 */
function timeOf(raw: string | undefined): number {
  if (raw === undefined) return 0
  const at = new Date(raw).getTime()
  return Number.isNaN(at) ? 0 : at
}
