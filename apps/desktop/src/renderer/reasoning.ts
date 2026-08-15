/**
 * 推理折成一行时显示哪一行。
 *
 * 抽成纯函数是因为这条规则是**有意的、会被质疑的**，得能单独钉住：
 * 跑着的时候看最后一行，跑完之后看第一行。
 */

/**
 * @param running 还在流。
 *
 * **跑着看最后一行**：那才是「它现在在想什么」——第一行是几十秒前的事了。
 * **跑完看第一行**：那时人要的是「这段讲的是什么」，而模型的推理
 * 几乎总是以一句主旨开头。
 */
export function summaryOf(text: string, running: boolean): string {
  const visible = text.trimEnd()
  if (!running) {
    const at = visible.indexOf("\n")
    return at === -1 ? visible : visible.slice(0, at)
  }
  const at = visible.lastIndexOf("\n")
  return at === -1 ? visible : visible.slice(at + 1)
}

/** 整行都是 `**…**` 的那种小标题。行内偶尔加粗一个词不算。 */
const HEADING = /^\s*\*\*(.+?)\*\*\s*$/

/**
 * 模型自己给这一段起的**小标题**。
 *
 * ## 为什么用它，而不是我们自己编一句
 *
 * 状态行现在写死「正在思考」。那句话的信息量是零——**它在想什么**才是人要的，
 * 而这件事只有模型知道。而模型其实一直在说：推理文本几乎总是这种形状——
 *
 *     **先确认分页的边界条件**
 *
 *     `page` 从 0 还是 1 开始要先看调用方…
 *
 * 那行加粗就是它给这一段起的名字。codex 的状态行显示的正是这个。
 *
 * **取最后一个**：和 `summaryOf` 跑着时取最后一行同一个道理——
 * 一段长推理会分好几节，每节一个小标题，而人要的是「现在这一节」。
 *
 * ## 没有小标题的时候
 *
 * 返回 `undefined`，调用方退回「正在思考」。有些引擎配置根本不吐推理摘要
 * （实测这台机器上的 codex 就不吐），那时这个函数永远返回 `undefined`——
 * **这不是失效，是它本来就该安静**：没有标题可显示时编一个才是错的。
 */
export function headingOf(text: string): string | undefined {
  const lines = text.split("\n")
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const hit = HEADING.exec(lines[i] ?? "")
    // 标题里再套加粗（`**a **b** c**`）会截出半截，不要
    if (hit?.[1] !== undefined && !hit[1].includes("**")) return hit[1].trim()
  }
  return undefined
}
