import type { ModelOption } from "@omni/protocol"
import type { AcpConfigOption, AcpModel, AcpNewSession } from "./wire.js"

/**
 * 开会话时要从 `session/new` 的结果里挖出来的东西。
 *
 * 单独一个文件的理由：这些全是纯函数，**不用起进程就能测**，
 * 而它们要处理的恰恰是最容易出错的一块——同一个适配器不同版本报的字段名不一样。
 */

/**
 * ACP 把推理强度**编进 modelId 里**（实测：`gpt-5.6-sol[low]`、`…[xhigh]`），
 * 没有独立的 effort 字段。所以这里不报 `efforts`——报了界面上会多出一个
 * 点了没用的强度选择器，而强度其实已经在模型列表里选过了。
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
  return (option?.options ?? [])
    .filter((o): o is { value: string; name?: string; description?: string | null } => typeof o.value === "string")
    .map((o) => ({
      id: o.value,
      label: o.name ?? o.value,
      ...(o.description === undefined || o.description === null ? {} : { description: o.description }),
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
  if (direct !== undefined && direct.length > 0) return direct.map(toModelOption)
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
