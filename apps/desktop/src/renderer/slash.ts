import type { SlashCommand } from "@switchback/protocol"

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

/** 命中就给个分，越像越大；没命中给 undefined。用同一套规则排引擎的和 Switchback 的。 */
function score(command: SlashCommand, query: string): number | undefined {
  // 空查询全都要，**不分高下**——先后由分节决定，不由这里塞一个偏置决定
  if (query === "") return 0
  const q = query.toLowerCase()
  const name = command.name.toLowerCase()
  // 中文名也参与前缀匹配：面板上显示的是「新建会话」，人自然会按它去筛
  if (command.label !== undefined && command.label.toLowerCase().startsWith(q))
    return 100 - name.length
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
 * 名字里被打中的那一段：`[前, 命中, 后]`。没打中就 undefined。
 *
 * **这是「补全」和「一张长列表」的区别。** 打了 `/de` 之后眼前是 46 行，
 * 光靠「它们都以 de 开头」这条**你自己推出来的**规律去扫，和一眼看见
 * 每行加粗的那两个字母，不是一件事——后者才让人相信这张表在跟着你打的字走。
 *
 * 大小写不敏感地找，但**切出来的是原文**：显示的必须是命令自己的写法
 *（`/DBQuery` 不能因为你打的是小写就变成小写）。
 *
 * 只在名字里找，不去说明里找：说明命中时高亮名字里碰巧同字母的那一处，
 * 是在**指错地方**——而指错比不指更糟。
 */
export function markOf(text: string, query: string): readonly [string, string, string] | undefined {
  if (query === "") return undefined
  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return undefined
  return [text.slice(0, at), text.slice(at, at + query.length), text.slice(at + query.length)]
}

/**
 * 输入框里那截**灰字预览**：选中这一条的话，`/` 后面还会补上什么。
 *
 * ## 为什么它值得存在
 *
 * `Tab` / `回车` 早就能补全了——但那件事**在界面上没有任何痕迹**：
 * 面板里高亮的那一行和输入框里的字是两个地方，人得自己把它们连起来。
 * 灰字把它连上了：你打的字后面直接长出剩下那半截，按下去就是它。
 *
 * ## 只补真前缀，大小写也得对上
 *
 * 灰字是**接在你打的字后面**显示的，所以它必须能和前面拼成命令的原名。
 * `/db` 对上 `DBQuery` 时补 `Query` 会拼出 `/dbQuery`——那不是任何一条命令，
 * 而按下去真正插进去的是 `/DBQuery`。**看到的和拿到的不一样，比没有预览更糟**，
 * 所以这一档宁可不补：面板里那一行仍然高亮着，回车照样选得中。
 */
export function ghostOf(command: SlashCommand | undefined, query: string): string {
  // 还没打字就不猜：那时候「排第一的那条」只是字母序的巧合，不是你的意图
  if (command === undefined || query === "") return ""
  return command.name.startsWith(query) ? command.name.slice(query.length) : ""
}

/** 每一节的保底条数。两节都放不下时，谁也不许把对方挤成零。 */
const SECTION_MIN = 4

/** 按来源分节，排在前面的先拿配额。**技能在前**，理由见 `matchCommands`。 */
const ORDER: readonly SlashCommand["source"][] = ["engine", "switchback"]

/**
 * 两节都放不下时怎么分。前一节优先吃满，但各自先保底 `SECTION_MIN`。
 *
 * 拆成纯函数是为了能直接测边界：一边零条、一边超额、两边都超额。
 */
function share(counts: readonly number[], limit: number): readonly number[] {
  const total = counts.reduce((a, b) => a + b, 0)
  if (total <= limit) return counts
  const floors = counts.map((n) => Math.min(n, SECTION_MIN))
  let rest = Math.max(0, limit - floors.reduce((a, b) => a + b, 0))
  return counts.map((n, i) => {
    const extra = Math.min(n - (floors[i] ?? 0), rest)
    rest -= extra
    return (floors[i] ?? 0) + extra
  })
}

/**
 * 筛出候选，排好序。返回的是**扁平的一串**（显示顺序即数组顺序），
 * 分节的界线由相邻两条的 `source` 变化看出来——键盘上下走的还是这一串，
 * 不用为分节再维护一套二维索引。
 *
 * ## 为什么技能排在前面
 *
 * Switchback 自己那十条**每一条在界面上都另有入口**（顶栏、右键菜单、快捷键）——
 * 那本来就是它们被收进命令面板的标准（见 `switchbackCommands.ts`）。
 * 而引擎的技能**在整个界面里没有第二扇门**：不在这儿列出来，
 * 用户根本不知道自己装的二十几个技能能用。没有别的门的那一节排在上面。
 *
 * ## 上一版为什么一条技能都看不见
 *
 * `limit` 是 12，而 Switchback 有 10 条、还在同分时排前面。于是空查询下
 * **技能最多只剩两条**，还落在列表最底下——面板一屏放不下，等于没有。
 * 实测这台机器 codex 报了 22 条技能，一条都没露过面。
 * 所以现在是按节配额 + 面板可滚，而不是一刀切到 12。
 */
export function matchCommands(
  commands: readonly SlashCommand[],
  query: string,
  limit = 100,
): readonly SlashCommand[] {
  const hits: { command: SlashCommand; score: number }[] = []
  for (const command of commands) {
    if (hidden(command)) continue
    const value = score(command, query)
    if (value !== undefined) hits.push({ command, score: value })
  }
  hits.sort((a, b) => b.score - a.score || (a.command.name < b.command.name ? -1 : 1))
  const sections = ORDER.map((source) => hits.filter((h) => h.command.source === source))
  const quota = share(
    sections.map((s) => s.length),
    limit,
  )
  return sections.flatMap((s, i) => s.slice(0, quota[i]).map((h) => h.command))
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

/** token 给人读的名字；底层 `name` 始终原样保留给引擎。 */
export function commandLabel(command: SlashCommand): string {
  const explicit = command.label?.trim()
  if (explicit !== undefined && explicit !== "") return explicit
  const raw = command.name.replace(/^skill:/, "").replace(/([a-z\d])([A-Z])/g, "$1 $2")
  return raw
    .split(/[-_.]+/)
    .filter((part) => part !== "")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

/** rich token + 参数重新合成引擎真正接收的斜杠文本。 */
export function commandText(command: SlashCommand | undefined, args: string): string {
  const suffix = args.trim()
  if (command === undefined) return suffix
  return suffix === "" ? `/${command.name}` : `/${command.name} ${suffix}`
}
