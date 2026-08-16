import type { SlashCommand } from "@omni/protocol"

/**
 * 斜杠命令面板的纯逻辑：什么时候算在打命令、怎么筛、怎么替换。
 *
 * 和 `mention.ts` 分开写而不是抽一层公共的：两者**规则不一样**——
 * `@` 可以出现在句子中间（「看一下 @a.ts 这个文件」），
 * 而 `/` **只在最开头才算命令**。硬凑成一套的代价是两边都得带一堆条件分支。
 */

export interface Slash {
  /** token 在文本里的起止（含 `/`）。 */
  start: number
  end: number
  /** 斜杠后面已经打了什么。 */
  query: string
}

/**
 * 光标处是不是在打一条斜杠命令。
 *
 * **只认开头**。理由是 `/` 在正常句子里太常见了（路径、日期、and/or），
 * 出现一次就弹面板会一直挡着字。而命令天然写在最前面——
 * 「先说要干什么，再说细节」。
 *
 * 已经打了空格就不再是选命令（`/code-review src/` 是在填参数了），
 * 面板该收起来，让位给正常输入。
 */
export function slashAt(text: string, caret: number): Slash | undefined {
  if (!text.startsWith("/")) return undefined
  const query = text.slice(1, caret)
  if (caret < 1 || /\s/.test(query)) return undefined
  return { start: 0, end: caret, query }
}

/**
 * 不该出现在面板里的。
 *
 * - `__` 开头是引擎的内部命令（实测 Claude 报了一条 `__remote-workflow`，
 *   说明写着「Run the workflow script delivered in this session environment」
 *   ——那是给harness自己用的，不是给人打的）。
 * - 说明以 `(removed)` 开头的是**已经废弃、只为兼容还留着名字**的
 *   （实测 `/agents` 就是）。列出来的唯一结果是有人点了然后发现没用。
 */
function hidden(command: SlashCommand): boolean {
  return command.name.startsWith("__") || command.description.trimStart().startsWith("(removed)")
}

/** 命中就给个分，越像越大；没命中给 undefined。用同一套规则排引擎的和 omni 的。 */
function score(command: SlashCommand, query: string): number | undefined {
  if (query === "") return command.source === "omni" ? 1 : 0
  const q = query.toLowerCase()
  const name = command.name.toLowerCase()
  // 中文名也参与前缀匹配：面板上显示的是「新建会话」，人自然会按它去筛
  if (command.label !== undefined && command.label.toLowerCase().startsWith(q)) return 100 - name.length
  // 前缀最像：打 `/re` 时 `/review` 该排在 `/code-review` 前面
  if (name.startsWith(q)) return 100 - name.length
  if (name.includes(q)) return 50 - name.length
  // **说明也参与匹配**：技能名常常是英文，而用户想的是中文
  //（codex 那边 displayName 就是中文，被拼进了说明里）
  if (command.label?.toLowerCase().includes(q) === true) return 40 - name.length
  if (command.description.toLowerCase().includes(q)) return 10
  return undefined
}

/**
 * 筛出候选，排好序。
 *
 * **omni 自己的命令在同分时排前面**：它们是「这个界面能做什么」，
 * 数量固定且用户天天见；引擎的技能有几十条，淹掉前者只是时间问题。
 */
export function matchCommands(
  commands: readonly SlashCommand[],
  query: string,
  limit = 12,
): readonly SlashCommand[] {
  const hits: { command: SlashCommand; score: number }[] = []
  for (const command of commands) {
    if (hidden(command)) continue
    const value = score(command, query)
    if (value !== undefined) hits.push({ command, score: value })
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.command.source === "omni") - Number(a.command.source === "omni") ||
      (a.command.name < b.command.name ? -1 : 1),
  )
  return hits.slice(0, limit).map((h) => h.command)
}

/**
 * 选中一条引擎命令之后，输入框里该是什么。
 *
 * **带参数的留在输入框里等你填**，不直接发出去——`/code-review <pr#>` 这种
 * 直接发等于发了一条缺参数的命令。没有参数的也只是补一个空格，
 * 让「选完再按回车」成为一个统一的动作，而不是有时选完就跑了、有时没跑。
 */
export function applyCommand(command: SlashCommand): { text: string; caret: number } {
  const text = `/${command.name} `
  return { text, caret: text.length }
}
