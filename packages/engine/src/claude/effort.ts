import type { ModelOption } from "@omni/protocol"

/**
 * Claude 的推理强度。
 *
 * ## 上一版为什么说「没有」——那句话过期了
 *
 * `driver.ts` 的 `models()` 上面原来写着：「SDK 的 `effort` 是 `Options` 字段，
 * 只能在 `query()` 时给，运行期没有 setter。报上去界面就会画一个改了不生效的控件。」
 * 前半句当时也许对，**现在不对**：`sdk.d.ts` 里公开声明着
 * `Query.applyFlagSettings({ effortLevel })`，文档写明它就是运行期改的那条路
 *（`'max'` 还是会话级的，不写进配置文件）。
 *
 * 这类「一次实测被写成永久结论」的注释，是这个代码库里最容易骗到下一个人的东西——
 * 它读起来像调查过的，而调查的对象已经变了。
 *
 * ## 清单一个字都不猜
 *
 * 每个模型自己报 `supportsEffort` 与 `supportedEffortLevels`。
 * **不支持的模型就不给强度**——给了就是一个改了不生效的控件，
 * 那正是上面那句注释当初想避免的事，只是原因不同。
 */

/** SDK 的 `ModelInfo` 里和强度有关的那两个字段。**只声明我们真的读的**。 */
interface EffortAware {
  supportsEffort?: boolean
  supportedEffortLevels?: readonly string[]
}

/**
 * 把一条模型的强度档挂上去。**报不出档位就整条不挂**——
 * 一个空的强度选择器比没有更糟：它看起来能选，点开是空的。
 */
export function withEfforts(option: ModelOption, raw: EffortAware): ModelOption {
  if (raw.supportsEffort !== true) return option
  const efforts = (raw.supportedEffortLevels ?? []).filter((e) => typeof e === "string" && e !== "")
  return efforts.length === 0 ? option : { ...option, efforts }
}

/** SDK 上那条运行期改强度的路。**公开声明的**，不像侧问那样要运行时探测。 */
interface EffortSettable {
  applyFlagSettings: (settings: { effortLevel: string }) => Promise<void>
}

function settable(query: unknown): query is EffortSettable {
  return typeof (query as Partial<EffortSettable> | undefined)?.applyFlagSettings === "function"
}

/**
 * 把强度设下去，**回报真正生效的那一档**。
 *
 * 设不上时回 `undefined` 而不是回请求值：调用方据此清掉未经确认的档位。理由和 ACP 那边一样——
 * 界面照着这条记录画，不能把上一模型的旧档或本次请求值冒充成结果。
 *
 * `applyFlagSettings` 没有返回值，所以「生效了」的判据是**它没有抛**。
 * 这比回报请求值强：那条路上失败是静默的。
 */
export async function applyEffort(query: unknown, effort: string | undefined): Promise<string | undefined> {
  if (effort === undefined || effort === "" || !settable(query)) return undefined
  await query.applyFlagSettings({ effortLevel: effort })
  return effort
}
