import { findSession, humanTurn, readEntries } from "./history.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { CLAUDE_FORK } from "./fork.messages.js"

/**
 * 原生分叉：从一条已经存在的会话岔出一条，可以只带前面若干轮。
 *
 * ## 这一位曾经报着 false
 *
 * `caps.ts` 上写了很久「SDK 没有复制会话的入口，只能诚实地开空白分支」。
 * 那句话在 0.3.231 上不成立——`Options` 里 `resume` + `forkSession` + `resumeSessionAt`
 * 三件套齐全，SDK 文档管这套叫 **edit-and-retry**。缺的从来不是入口，是接线。
 *
 * ## 为什么要自己去读那个 jsonl
 *
 * 宿主给的是 `{ handle, dropTurns }`——**「砍掉最后 N 轮」**，因为那是界面上说得清的话
 *（「回到这一轮之前」）。而 SDK 要的是 `resumeSessionAt: <某条 chain entry 的 uuid>`。
 * 两者之间差着一次翻译，而翻译需要那条会话的原文。
 *
 * 新会话的驱动是个全新实例，它没见过老会话的任何一条消息，所以只能去文件里找。
 * 好在 Claude 把整段对话都写在 `~/.claude/projects` 下那个以会话 id 命名的 jsonl 里，
 * `history.ts` 早就在读它了（接管历史会话那条路）。
 *
 * ## 分叉点取「留下的最后一轮的最后一条」
 *
 * SDK 文档里那条总则原话：**fork at the KEPT turn's last chain entry, whatever it is**。
 * 不是「最后一条 assistant 消息」——一轮的尾巴上可能挂着 tool_result、
 * structured_output 附件之类，落在丢弃区里会被校验器拒掉（而且那些本来就属于要留下的那一轮）。
 * 所以这里往回退到「下一轮开头的前一条」，那条是什么就用什么。
 *
 * ## 为什么暂时不带 `resumeDropsTurn`
 *
 * 那个字段是校验闸：声明「我打算丢掉哪一轮」，CLI 会核对丢弃区里没有别的东西
 *（比如会话中途自己吸收进来的排队消息），对不上就**确定性地拒绝**。
 * 它更安全，但它要求调用方实现一条恢复路径（文档明说不许重试，因为重试永远失败）。
 * 这一版先走不带闸的那条（文档：「Omit to keep the unvalidated truncation behavior」），
 * **代价写在这儿**：丢弃区里若混进了非本轮的东西，会被一起丢掉而没有任何提示。
 */

/** 分叉时要给 SDK 的那几项。`at` 缺席＝整条复制，不截断。 */
export interface ForkPlan {
  resume: string
  at: string | undefined
}

/**
 * 把宿主的 `{ handle, dropTurns }` 翻成 SDK 要的分叉点。
 *
 * 找不到那条会话、或者要丢的轮数比现有的还多时**抛**：调用方（`branch()` 那边）
 * 对「重来」是不允许退回空白分支的——那会让用户以为带着上下文，其实什么都没带。
 */
export async function planFork(
  home: string,
  forkOf: { handle: string; dropTurns?: number },
  locale: Locale = DEFAULT_LOCALE,
): Promise<ForkPlan> {
  const drop = forkOf.dropTurns ?? 0
  if (drop <= 0) return { resume: forkOf.handle, at: undefined }
  const path = await findSession(home, forkOf.handle)
  if (path === undefined) throw new Error(CLAUDE_FORK[locale].noSession(forkOf.handle))
  const entries = await readEntries(path)
  const at = cutAt(entries, drop)
  if (at === undefined) throw new Error(CLAUDE_FORK[locale].tooFew)
  return { resume: forkOf.handle, at }
}

/**
 * 砍掉最后 `drop` 轮之后，**留下的最后一条**的 uuid。
 *
 * 纯函数（不读文件、不读时钟），所以能被表驱动测——分叉点算错的后果是
 * 少带或多带一轮上下文，而那种错在界面上完全看不出来。
 */
export function cutAt(
  entries: readonly Record<string, unknown>[],
  drop: number,
): string | undefined {
  if (drop <= 0) return undefined
  const starts: number[] = []
  for (const [i, entry] of entries.entries()) if (humanTurn(entry)) starts.push(i)
  // 要丢 drop 轮，第一条被丢的就是倒数第 drop 轮的开头
  const first = starts[starts.length - drop]
  // 轮数不够：`starts.length < drop` 时取不到。**一轮都不留也算不够**——
  // 那等于开一条空会话，而那时调用方本来就该走空白分支，不该走分叉
  if (first === undefined || first === starts[0]) return undefined
  return uuidBefore(entries, first)
}

/**
 * 从 `index` 往前找第一条带 uuid 的记录。
 *
 * 往前找而不是直接取 `index - 1`：那个位置可能是一条没有 uuid 的元数据行
 *（`isMeta`、标题、模式变更都写在同一个文件里）。**取到的必须是一条 chain entry**，
 * 否则 `resumeSessionAt` 认不出来。
 */
function uuidBefore(entries: readonly Record<string, unknown>[], index: number): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const id = entries[i]?.["uuid"]
    if (typeof id === "string" && id !== "") return id
  }
  return undefined
}
