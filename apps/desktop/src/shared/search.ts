/**
 * 跨会话正文搜索的结果形状。
 *
 * 放 `shared/` 而不是 `main/`：preload 与渲染层都要用它，而
 * **preload 不该 import 主进程的模块**——那条 import 就算只带类型，
 * 也是在两个进程之间连一根将来会被人当成运行时依赖的线。
 */
export interface ContentHit {
  threadId: string
  /** 提到过的消息条数。 */
  count: number
  /** 最像那句话的一条（含最多关键词的那条），已裁到可读长度。 */
  snippet: string
  /** 那条消息的时间。排序用。 */
  at: number
}

export interface SearchOut {
  hits: readonly ContentHit[]
  /** 预算用完了，剩下的没扫。**必须说**——不说就等于「只有这些」。 */
  skipped: number
}
