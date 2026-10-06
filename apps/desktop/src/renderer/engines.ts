import type { EngineInfo, Thread } from "@switchback/protocol"
import { BUILTIN_ENGINES } from "../shared/builtin-engines.js"

/** 已存在的会话不能因引擎后来退出新建清单，就丢掉名字和当前选择。 */
export function withThreadEngines(
  engines: readonly EngineInfo[],
  threads: readonly Pick<Thread, "engine" | "engineProfile">[],
): readonly EngineInfo[] {
  const seen = new Set(engines.map((engine) => engine.id))
  const missing: EngineInfo[] = []
  for (const thread of threads) {
    if (seen.has(thread.engine)) continue
    seen.add(thread.engine)
    const builtin = BUILTIN_ENGINES.find((engine) => engine.id === thread.engine)
    missing.push({
      id: thread.engine,
      label: builtin?.label ?? thread.engine,
      state: "unknown",
      ...(thread.engineProfile === undefined ? {} : { profile: thread.engineProfile }),
    })
  }
  return missing.length === 0 ? engines : [...engines, ...missing]
}

/**
 * 分叉到「下一家」：引擎清单里当前这家之后的那一个，绕回开头。
 *
 * 只有两家时它就是「另一家」，语义毫无歧义；三家以上时按顺序轮。
 * 做成一个按钮而不是一个下拉：分叉不是常用操作，为它摆一个常驻的选择器
 * 只会把顶栏挤满。
 *
 * **跳过探测出「没装」的那些**。分叉是一键动作，没有确认步骤——
 * 一键分叉到一个装都没装的引擎，得到的只有一条报错和一个空会话。
 * 全都没装时退回原来的轮法：探测会错，不能因此让按钮彻底消失。
 */
export function nextEngine(engines: readonly EngineInfo[], current: string): EngineInfo | undefined {
  if (engines.length < 2) return undefined
  const rotate = (list: readonly EngineInfo[]): EngineInfo | undefined => {
    const at = list.findIndex((e) => e.id === current)
    return list[(at + 1) % list.length]
  }
  const usable = engines.filter(
    (e) => (e.state !== "missing" && e.state !== "unavailable") || e.id === current,
  )
  return usable.length >= 2 ? rotate(usable) : rotate(engines)
}
