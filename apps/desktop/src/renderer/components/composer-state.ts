/**
 * 输入区的几个纯状态函数。
 *
 * **从 `Composer` 搬出来是行数闸门逼的**，但这一刀也顺：那边是「这一屏怎么摆、
 * 接上哪些回调」，这边是「此刻能不能发、发出去会怎样」——后者每一条都带着
 * 一段「上一版为什么错」的理由，堆在 JSX 中间读不动。
 */

/**
 * 输入区现在处在哪一档。**四档互斥**，而且各有各的文案和右下角那颗键：
 * 历史记录 / 引擎还在起 / 跑着但能插话 / 跑着只能排队。
 *
 * 拎出来是复杂度闸门逼的，但边界也对：这是一次判定，不是渲染。
 */
export function stateOf(o: { detached: boolean; starting: boolean; busy: boolean; canSteer: boolean }): {
  blocked: boolean
  queueing: boolean
  steering: boolean
} {
  const running = o.busy && !o.detached
  return {
    // 真正发不出去的只有两种：这是历史记录（背后没有引擎），
    // 以及**引擎还没起来**——后者不禁的话，回车会先清空输入框、
    // 再撞上宿主那句「会话不存在」，打好的一句话就这么没了
    blocked: o.detached || o.starting,
    // **默认排队，不管引擎会不会 steer。** 上一版是「能插就插」，
    // 和 codex 自己的行为正好相反（那边打字回车也是排着的）。
    // `steering` 现在的意思变成「这一条会话**能**当场插入」——
    // 它决定的是提示语和「立刻插入」那颗按钮出不出现，不是默认走哪条路
    queueing: running,
    steering: running && o.canSteer,
  }
}

/**
 * 右下角那颗键是不是禁着的。
 *
 * **附件被挡住时也算空**：那时按下去什么都不会发生，一颗能按但没反应的键
 * 比一颗灰的更糟。选了引擎命令时不算空——命令本身就是要发的那句话。
 */
export function nothingToSend(o: {
  attachmentBlocked: boolean
  text: string
  hasCommand: boolean
  attachments: number
  /** 输入框上方那排芯片（拖进来的文件、折起来的粘贴）有几枚。 */
  blocks: number
}): boolean {
  if (o.attachmentBlocked) return true
  // **芯片也算「有东西要发」**：拖一份日志进来、一个字不打直接回车是成立的用法，
  // 而上一版那些路径写在正文里，所以「正文空」天然就等于「没东西发」。
  // 换成芯片之后这条不再自动成立，得在这里说出来
  return o.text.trim() === "" && !o.hasCommand && o.attachments === 0 && o.blocks === 0
}

/** 图片还挂着时，任何会静默丢图的发送路径都必须先停下来。 */
export function attachmentWarning(o: {
  attachments: number
  canAttach: boolean
  pending: boolean
  aside: boolean
}): string | undefined {
  if (o.attachments === 0) return undefined
  if (o.aside) return "侧问不支持图片附件；图片已保留，请移除或退出侧问后再发"
  if (o.pending) return "请先完成引擎切换，再确认新引擎能否接收这些附件；附件会保留"
  if (!o.canAttach) return "当前引擎或模型不支持图片附件；附件已保留，请移除或切换后再发"
  return undefined
}
