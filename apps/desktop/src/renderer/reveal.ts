/**
 * 「在访达里给我看看这个文件」。
 *
 * ## 为什么直接问桥，不层层传回调
 *
 * 它是一个**全局能力**，不是某条会话的状态——和「复制」「导出诊断」同类。
 * 层层往下传的代价是转录区那几个 memo 组件都要多一个 prop，而它们的稳定性
 * 正是长会话不卡的原因。设置面板、引擎版本那几处早就是直接问桥的。
 *
 * ## 两道闸
 *
 * - **只认绝对路径**。各家引擎报路径的规矩不齐：Claude 那边取不到时会给空串，
 *   ACP 那边是把 agent 给什么原样透传。相对路径交给 `showItemInFolder`
 *   会解析到进程的工作目录去——那是个和用户无关的地方，弹出来只会让人困惑。
 * - **只定位，不打开、不执行**（主进程走 `showItemInFolder`）。最坏的后果
 *   就是访达里跳出一个窗口。要「用编辑器打开」得先决定用哪个编辑器，那是另一件事。
 */
export function revealable(path: string | undefined): path is string {
  return typeof path === "string" && path.startsWith("/")
}

export function reveal(path: string): void {
  if (!revealable(path)) return
  const bridge = typeof window === "undefined" ? undefined : window.omni
  bridge?.reveal(path)
}
