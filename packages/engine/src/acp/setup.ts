import type { EngineCapabilities, EngineThread, ModelOption } from "@omni/protocol"
import type {
  AcpConfigOption,
  AcpInitialize,
  AcpModel,
  AcpNewSession,
  AcpSessionRow,
} from "./wire.js"

/** `session/new` 的兼容翻译；保持纯函数，所有协议分支都可直接单测。 */

/** 模型条目只翻模型；独立强度由 `effortsOf` 从 agent 报告里补。 */
function toModelOption(raw: AcpModel): ModelOption {
  const id = raw.modelId ?? ""
  const base: ModelOption = {
    id,
    label: raw.name ?? id,
    ...(raw.description === undefined || raw.description === null
      ? {}
      : { description: raw.description }),
  }
  return withMetaEfforts(base, raw)
}

/** 模型扩展位里的强度清单；线上的规范值是 `value`，不拿展示用的 `id` 代替。 */
function withMetaEfforts(option: ModelOption, raw: AcpModel): ModelOption {
  const meta = raw._meta as { reasoningEfforts?: unknown; reasoningEffort?: unknown } | undefined
  const list = Array.isArray(meta?.reasoningEfforts) ? meta.reasoningEfforts : []
  const efforts = list
    .map((e) => (e as { value?: unknown }).value)
    .filter((v): v is string => typeof v === "string" && v !== "")
  if (efforts.length === 0) return option
  const current = meta?.reasoningEffort
  return {
    ...option,
    efforts,
    ...(typeof current === "string" && current !== "" ? { defaultEffort: current } : {}),
  }
}

/** config option 当前值；不是字符串就当没报告。 */
function currentOf(option: AcpConfigOption | undefined): string | undefined {
  return typeof option?.currentValue === "string" ? option.currentValue : undefined
}

function fromConfigOption(option: AcpConfigOption | undefined): readonly ModelOption[] {
  const current = currentOf(option)
  return (option?.options ?? [])
    .filter(
      (o): o is { value: string; name?: string; description?: string | null } =>
        typeof o.value === "string",
    )
    .map((o) => ({
      id: o.value,
      label: o.name ?? o.value,
      ...(o.description === undefined || o.description === null
        ? {}
        : { description: o.description }),
      // **agent 当前用的那个要标出来。** 不标的话界面退回列表第一个，
      // 于是面板上写着「K2.7 Coding」而引擎其实在跑 K3——一个安静的谎
      ...(o.value === current ? { isDefault: true } : {}),
    }))
}

/**
 * 模型清单与设置路由必须一起算：从 `configOptions` 读到的模型要设回同一个
 * config id；直接模型清单才走 `session/set_model`。兼容证据移到工程时间线。
 */
export interface ModelCatalog {
  models: readonly ModelOption[]
  /**
   * 换模型走 `session/set_config_option` 时的 `configId`。
   * **`undefined` 表示走规范的 `session/set_model`**。
   */
  configId?: string
  /** agent 当前模型；既标默认项，也供中途变更回写 `Thread.model`。 */
  current?: string
}

/** 强度只挂当前模型；agent 未报当前模型时才退回全挂，避免整段能力消失。 */
function withLevels(
  model: ModelOption,
  levels: { id: string; efforts: readonly string[]; current?: string } | undefined,
  current: string | undefined,
): ModelOption {
  if (levels === undefined) return model
  if (current !== undefined && model.id !== current) return model
  return {
    ...model,
    efforts: levels.efforts,
    ...(levels.current === undefined ? {} : { defaultEffort: levels.current }),
  }
}

export function modelCatalogOf(session: AcpNewSession): ModelCatalog {
  const direct = session.models?.availableModels
  if (direct !== undefined && direct.length > 0) {
    const current = session.models?.currentModelId
    return {
      models: distinct(
        direct.map((m) => {
          const option = toModelOption(m)
          return option.id === current ? { ...option, isDefault: true } : option
        }),
      ),
      ...(current === undefined ? {} : { current }),
    }
  }
  const option = session.configOptions?.find((o) => o.id === "model")
  const models = distinct(fromConfigOption(option))
  const current = currentOf(option)
  return {
    models,
    ...(option?.id === undefined || models.length === 0 ? {} : { configId: option.id }),
    ...(current === undefined ? {} : { current }),
  }
}

/** 不替 agent 判可用性；只给重名项补 id，让用户能区分线上身份。 */
function distinct(models: readonly ModelOption[]): readonly ModelOption[] {
  const count = new Map<string, number>()
  for (const m of models) count.set(m.label, (count.get(m.label) ?? 0) + 1)
  return models.map((m) =>
    (count.get(m.label) ?? 0) > 1 ? { ...m, label: `${m.label}（${m.id}）` } : m,
  )
}

/** 只要清单的那一半。换模型要连「设回哪儿」一起看，用 `modelCatalogOf`。 */
export function modelsOf(session: AcpNewSession): readonly ModelOption[] {
  return modelCatalogOf(session).models
}

/** 模型、强度和两条设置路由的一致快照，开场与配置更新共用。 */
export interface Catalog {
  models: readonly ModelOption[]
  /** 换模型的 configId；`undefined` = 走 `session/set_model`。 */
  modelConfig?: string
  /** agent 当前模型；配置更新时用它同步宿主记录。 */
  model?: string
  /** 换强度的 configId；没有强度这一项时缺席。 */
  effortConfig?: string
  /** 当前强度。 */
  effort?: string
}

export function catalogOf(session: AcpNewSession): Catalog {
  const { models, configId, current } = modelCatalogOf(session)
  const levels = effortsOf(session)
  return {
    // 不把当前模型的强度猜成别的模型也支持；目标模型未报告时让 agent 用原生默认。
    models: models.map((m) => withLevels(m, levels, current)),
    ...(configId === undefined ? {} : { modelConfig: configId }),
    ...(current === undefined ? {} : { model: current }),
    ...(levels === undefined ? {} : { effortConfig: levels.id }),
    ...(levels?.current === undefined ? {} : { effort: levels.current }),
  }
}

/** 换模型的协议路由，单独导出以钉住两种线上形状。 */
export function modelCall(
  configId: string | undefined,
  sessionId: string,
  model: string,
): { method: string; params: Readonly<Record<string, string>> } {
  return configId === undefined
    ? { method: "session/set_model", params: { sessionId, modelId: model } }
    : { method: "session/set_config_option", params: { sessionId, configId, value: model } }
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

/** 模型 → agent 扩展位报告的窗口；没报告就不画比例，不猜分母。 */
export function contextWindows(session: AcpNewSession): Readonly<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const model of session.models?.availableModels ?? []) {
    const size = model._meta?.totalContextTokens
    if (model.modelId === undefined || typeof size !== "number" || size <= 0) continue
    out[model.modelId] = size
  }
  return out
}

/** 只翻译明确的未实现错误；其余保留 agent 原文。 */
export function sayWhy(engine: string, what: string, error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (!/method not found|-32601/i.test(text)) return `${engine} ${what}失败：${text}`
  return `${engine} 这个适配器不支持在会话里${what}（对应的 ACP 方法它没实现）。要改就去它自己的界面或配置里改，改完新开一条会话。`
}

/** 把明确的 spawn 失败补成可执行的安装/权限提示。 */
export function startupMessage(command: string, error: Error): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === "ENOENT") {
    return `找不到可执行文件 \`${command}\`。请确认这个 ACP 适配器已安装且在 PATH 上（终端里跑 \`which ${command}\` 验证）。`
  }
  if (code === "EACCES") return `没有权限执行 \`${command}\`。`
  return `启动 \`${command}\` 失败：${error.message}`
}

/**
 * agent 用 config option 报的强度。优先认协议语义 `category=thought_level`，
 * 同时保留原始 config id 作为设置地址；强度最终只挂当前模型。
 */
export function effortsOf(
  session: AcpNewSession,
): { id: string; efforts: readonly string[]; current?: string } | undefined {
  const option = session.configOptions?.find(
    (o) => o.category === "thought_level" || o.id === "thinking" || o.id === "effort",
  )
  const efforts = (option?.options ?? [])
    .map((o) => o.value)
    .filter((v): v is string => typeof v === "string")
  if (option?.id === undefined || efforts.length === 0) return undefined
  const current = typeof option.currentValue === "string" ? option.currentValue : undefined
  return { id: option.id, efforts, ...(current === undefined ? {} : { current }) }
}

/** agent 声明的能力直接翻译；空对象也是已声明，所以按键存在判断。 */
/** 各家自己说的那几位。协议里推不出来，见 `AcpDriverConfig`。 */
export interface AcpSaid {
  modeReadback?: boolean
  compact?: boolean
  steer?: boolean
  fork?: boolean
  activity?: boolean
}

export function capabilitiesOf(
  info: AcpInitialize | undefined,
  said: AcpSaid = {},
): EngineCapabilities {
  const agent = info?.agentCapabilities
  const session = agent?.sessionCapabilities ?? {}
  return {
    // 协议没有 compact/steer 声明位；只能由已验证的适配配置显式提供。
    compact: said.compact === true,
    attachments: agent?.promptCapabilities?.image === true,
    steer: said.steer === true,
    fork: "fork" in session || said.fork === true,
    // ACP v1 的 fork 只复制会话末尾；协议没有历史 message/turn 边界参数。
    rewind: false,
    // 没有 mode readback 声明位；未知不能冒充实时状态。
    modeReadback: said.modeReadback === true,
    // ACP 没暴露侧问；不拿某家私有能力替协议补洞。
    sideQuestion: false,
    // ACP 没有声明位；只有适配器已经接住引擎自己公开的私有活动通知时才敢报 true。
    activity: said.activity === true,
  }
}

/** agent 支不支持列历史会话。 */
export function canList(info: AcpInitialize | undefined): boolean {
  return "list" in (info?.agentCapabilities?.sessionCapabilities ?? {})
}

/** `session/list` 翻译；缺句柄无法续跑，缺 cwd 无法守住工作区边界，均丢弃。 */
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
