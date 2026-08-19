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

/**
 * 这个 configOption 上 agent 当前选中的值。**不是字符串就当没有**——不猜。
 *
 * 单拎出来是因为它有两个读者（下面的清单标注、`modelCatalogOf` 报当前模型），
 * 而这类「判据抄了两份」的地方，代码库里已经吃过亏：见 `modelCatalogOf` 的注释。
 */
function currentOf(option: AcpConfigOption | undefined): string | undefined {
  return typeof option?.currentValue === "string" ? option.currentValue : undefined
}

function fromConfigOption(option: AcpConfigOption | undefined): readonly ModelOption[] {
  const current = currentOf(option)
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
 * 模型清单，**外加「换模型该往哪儿发」**。
 *
 * ## 两条路都要走
 *
 * 实测同一个 codex 适配器的两个版本：1.3.0 报 `models.availableModels`，
 * 0.16.0 报 `configOptions[id="model"]`。只认一条，另一个版本的用户
 * 一个模型都选不出来。
 *
 * ## 为什么「从哪儿读的」必须一起带出来
 *
 * 因为**换模型要设回同一个地方**。清单从 `configOptions` 读、却拿
 * `session/set_model` 去设，是实测炸过的：ZCode 的桥（zcode-acp-server）
 * 只实现了 `session/set_config_option`，规范拼写的 `session/set_model`
 * 在它那儿是 `Method not found`——界面上于是弹一条红色的「引擎故障」，
 * 而用户只是点了一下模型下拉。
 *
 * 分成两个函数就会漂移：判断走哪条路的条件必须只有一处。
 */
export interface ModelCatalog {
  models: readonly ModelOption[]
  /**
   * 换模型走 `session/set_config_option` 时的 `configId`。
   * **`undefined` 表示走规范的 `session/set_model`**。
   */
  configId?: string
  /**
   * agent **此刻正在用**的那个模型 id。
   *
   * 两条路都能报出来（`models.currentModelId` / `configOptions` 的 `currentValue`），
   * 而现在只被用来在清单里打一个 `isDefault` 标记。**光有标记不够**：
   * 界面画的是选中项（`Thread.model`），不是清单里谁带标记——
   * agent 中途自己换了模型时，清单会更新，选中项不会，于是面板上写着
   * 一个引擎已经不在跑的模型。这一条就是给那条回写用的，见 `Catalog.model`。
   */
  current?: string
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

/**
 * 重名的两条要在下拉里分得开。
 *
 * 实测 ZCode：会话当前用的模型来自一个**没启用的 provider** 时，桥会把它原样
 * 补进清单（`anthropic\GLM-5.3`），而它报的名字就是 `GLM-5.3`——于是下拉里出现
 * **两行一模一样的「GLM-5.3」，其中一行点下去必然失败**（那个 provider 在
 * ZCode 自己的配置里是坏的）。
 *
 * omni 不替引擎判断哪一条能用（那是它自己的事），但两行长得一模一样是界面的事：
 * 重名就把 id 带上，让人看得出自己在选哪一个。
 */
function distinct(models: readonly ModelOption[]): readonly ModelOption[] {
  const count = new Map<string, number>()
  for (const m of models) count.set(m.label, (count.get(m.label) ?? 0) + 1)
  return models.map((m) => ((count.get(m.label) ?? 0) > 1 ? { ...m, label: `${m.label}（${m.id}）` } : m))
}

/** 只要清单的那一半。换模型要连「设回哪儿」一起看，用 `modelCatalogOf`。 */
export function modelsOf(session: AcpNewSession): readonly ModelOption[] {
  return modelCatalogOf(session).models
}

/**
 * 一份**能直接用**的模型清单：模型 ＋ 强度 ＋ 两条设置路由。
 *
 * ## 为什么合成一个
 *
 * 这四样必须同时算出来、同时换掉：清单从哪儿读的决定了设回哪儿（`configId`），
 * 而**强度的词表是跟着模型走的**——实测 ZCode：GLM-5.3 有 low/high/max，
 * 换到 GLM-5-Turbo 之后一个都没有（发过去引擎直接报错）。
 *
 * 算它的地方有两处（开会话时、agent 中途报 `config_option_update` 时），
 * 分成两份实现的下场是其中一份迟早漏掉一样，而漏掉不会报错，只会让界面撒谎。
 */
export interface Catalog {
  models: readonly ModelOption[]
  /** 换模型的 configId；`undefined` = 走 `session/set_model`。 */
  modelConfig?: string
  /**
   * agent 此刻在用的模型 id（见 `ModelCatalog.current`）。
   *
   * 算这份清单的两处里，**只有 `config_option_update` 那处需要它**——
   * 开会话时宿主自己就知道要用哪个模型，中途换掉才是它单方面做的事。
   * 但两处共用一个 `catalogOf`（那正是它存在的理由），所以两处都带上。
   */
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
    // 强度是**会话级**的（kimi 的 thinking 换模型不换档），所以挂到每个模型上
    // 都是同一份。界面那套「模型 → 强度」的形状正好装得下
    models:
      levels === undefined
        ? models
        : models.map((m) => ({
            ...m,
            efforts: levels.efforts,
            ...(levels.current === undefined ? {} : { defaultEffort: levels.current }),
          })),
    ...(configId === undefined ? {} : { modelConfig: configId }),
    ...(current === undefined ? {} : { model: current }),
    ...(levels === undefined ? {} : { effortConfig: levels.id }),
    ...(levels?.current === undefined ? {} : { effort: levels.current }),
  }
}

/**
 * 换模型这一发**发给谁、带什么**。
 *
 * 单拎出来是为了能钉住：坏掉的就是这一个选择（一律发 `session/set_model`），
 * 而它藏在驱动的一行三元里，谁都测不到。
 */
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

/**
 * 每个模型的上下文窗口有多大。
 *
 * ACP **没有为窗口大小定字段**，但它在扩展位里：实测 grok 每个模型都报
 * `_meta.totalContextTokens`（4.6 与 4.5 都是 500000）。
 *
 * 为什么要按模型存一张表、而不是只记当前那个：换模型时窗口是会变的
 *（同一家的两个模型一个 256k 一个 1M），只记一个数的话换完之后分母就是错的，
 * 而界面上那条比例条会一本正经地按错分母画。
 *
 * 报不上来的模型不入表——**没有分母就不画比例**，而不是猜一个。
 */
export function contextWindows(session: AcpNewSession): Readonly<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const model of session.models?.availableModels ?? []) {
    const size = model._meta?.totalContextTokens
    if (model.modelId === undefined || typeof size !== "number" || size <= 0) continue
    out[model.modelId] = size
  }
  return out
}

/**
 * 把一次 RPC 失败翻成人能照着做的一句话。
 *
 * `"Method not found": session/set_model` 是**协议实现的事实**，不是用户看得懂的话——
 * 它真正说的是「这家适配器没实现这件事」。那就直接这么说，并且说清楚现在能怎么办。
 *
 * 其余错误**原样带出去**：编不出更好的话时，原文比编出来的话有用。
 */
export function sayWhy(engine: string, what: string, error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (!/method not found|-32601/i.test(text)) return `${engine} ${what}失败：${text}`
  return `${engine} 这个适配器不支持在会话里${what}（对应的 ACP 方法它没实现）。要改就去它自己的界面或配置里改，改完新开一条会话。`
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
 *
 * ## `id` 必须带出来，不能事后猜
 *
 * 设回去的时候要报的正是这个 `id`，而各家起的名字不一样：kimi 是 `thinking`，
 * **ZCode 是 `thought`**（它的注释里写得很清楚：category 用 `thought_level`
 * 好让客户端认出来，而 `id` 保持 `thought`，因为那是 `set_config_option`
 * 寻址用的）。上一版把 `thinking` 写死在设置那一步，于是在 ZCode 上
 * 选了强度**什么都没发生**——而界面照样把新档位显示出来。
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
export function capabilitiesOf(info: AcpInitialize | undefined, modeReadback = false): EngineCapabilities {
  const agent = info?.agentCapabilities
  const session = agent?.sessionCapabilities ?? {}
  return {
    // ACP 没有压缩上下文的方法（实测 kimi：`session/compact` → Method not found）
    compact: false,
    attachments: agent?.promptCapabilities?.image === true,
    // ACP 没有「往正在跑的那一轮里插一句」的入口
    steer: false,
    fork: "fork" in session,
    // **协议里没有「我会不会报档位变化」这种声明**，推不出来，只能由各家自己说
    //（见 `AcpDriverConfig.modeReadback`）。没人说就是不知道——**不知道一律报 false**：
    // 报 true 的代价是界面上那行「引擎侧：X」永远停在开场那一刻，而它看起来是实时的
    modeReadback,
    // ACP 协议里没有侧问。kimi 的 `/btw` 实现得很完整，但它没从 ACP 那扇门出来——
    // 不是 kimi 弱，是这条路不通（见 `docs/侧栏与引擎状态方案.md` §6.3）
    sideQuestion: false,
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
