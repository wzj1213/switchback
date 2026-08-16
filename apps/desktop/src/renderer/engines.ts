import type { EngineInfo } from "@omni/protocol"

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
  const usable = engines.filter((e) => e.state !== "missing" || e.id === current)
  return usable.length >= 2 ? rotate(usable) : rotate(engines)
}
