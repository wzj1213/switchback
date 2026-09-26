/**
 * 「重新探测」之后说什么。
 *
 * ## 为什么必须说点什么
 *
 * 一颗按下去什么都不发生的按钮，用户的第一反应是再按一遍，第二反应是
 * 「这按钮坏了」。而重新探测**大多数时候本来就什么都不会变**——
 * 那正是它最需要说话的时刻：「我查过了，确实没变」和「我没查」
 * 在屏幕上必须分得出来。
 *
 * ## 为什么只分两拨
 *
 * 探测有四档（ok / missing / unavailable / unknown），但用户在这一刻只关心一件事：
 * **这一家现在能不能用。** 「起不来」和「没装」在这句总结里是同一拨——
 * 具体差别由那一行自己的状态说明去讲，不在这句话里塞四个词。
 */
export interface EngineChange {
  id: string
  label: string
  state?: string
}

/**
 * @param needsRestart `engines.json` 里改过或删掉、因为有会话在用而这一次没兑现的那几家。
 *   **必须单独说**：它和上面那两拨不是一回事——那两拨是「已经变了」，
 *   这一拨是「我看见你改了，但没生效」。混进同一句里，人会以为改完了。
 */
export function rescanMessage(
  changed: readonly EngineChange[],
  needsRestart: readonly string[] = [],
): string {
  const ready = changed.filter((one) => one.state === "ok").map((one) => one.label)
  const lost = changed.filter((one) => one.state !== "ok").map((one) => one.label)
  const parts: string[] = []
  if (ready.length > 0) parts.push(`认出了 ${ready.join("、")}`)
  if (lost.length > 0) parts.push(`${lost.join("、")} 现在用不了了`)
  if (parts.length === 0) parts.push("查过了，没有变化——装的还是那几家")
  const tail = needsRestart.length === 0
    ? ""
    : `${needsRestart.join("、")} 改过了，但有会话正在用它——关掉那些会话后再点一次，或者重启 omni。`
  return `${parts.join("；")}。${tail}`
}
