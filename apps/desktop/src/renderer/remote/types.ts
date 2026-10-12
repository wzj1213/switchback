import type { Bodies } from "./bodies.js"
import type { History } from "./connection.js"

/**
 * 远程窗口的桥比 preload 多出来的那几样。**全是可选的**：本机窗口（preload）一样都没有，
 * 读到 undefined 就是「这是本机」。
 */
export interface RemoteExtras {
  /**
   * 引擎实际跑在哪台机器上（宿主报的主机名）。**有值 = 这是远程窗口**——
   * 「在访达中显示」「用编辑器打开」这些只在宿主屏幕上有意义的入口据此藏起来。
   */
  remoteHost?: string
  /** 单独补到一条会话的正文（分级全量的另一半，见 `bodies.ts`）。 */
  onHistory?: (listener: (history: History) => void) => () => void
  /** 哪些会话的正文还在路上、哪些被裁过。 */
  bodies?: Bodies
}
