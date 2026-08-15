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
