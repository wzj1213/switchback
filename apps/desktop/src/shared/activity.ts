/**
 * 「活动」那一页的数据形状。**主进程算，渲染层只画。**
 *
 * ## 为什么不在渲染层用现成的 store 算
 *
 * 渲染层手上确实有全部会话（启动时整份 journal 回放过一遍），但它拿到的是
 * **归约之后的当前状态**：`usage` 只剩每条会话最后报的那一份，轮次只剩没跑完的那条。
 * 「8 月 3 号烧了多少 token」在那份状态里根本不存在——要按天分桶，只能回到
 * 事件流本身，而事件流在磁盘上。
 *
 * ## 这一页只说磁盘上有的
 *
 * 它统计的是 **omni 自己记下的那些会话**，不是「你用了多少 Claude」：
 * 你在终端里跑的那些 omni 没有记录，引擎自己的账单 omni 也读不到。
 * 界面上必须把这个边界写出来——一个看起来像账单、实际只覆盖一部分的数字，
 * 比没有这一页更糟。
 */

/** 一天一格。`date` 是**本机时区**的 `YYYY-MM-DD`——热力图是按你自己的日历读的。 */
export interface ActivityDay {
  date: string
  /** 当天新增的 token。**只算报了累计用量的引擎**，口径见 `tokensByEngine`。 */
  tokens: number
  /** 当天跑了多少轮。 */
  turns: number
  /** 当天你说了多少句。 */
  asks: number
  /** 当天引擎调了多少次工具。 */
  tools: number
}

/** 热力图按哪一项着色。**默认不是 token**，理由见 `ActivityDigest.tokensByEngine`。 */
export type ActivityMetric = "turns" | "asks" | "tools" | "tokens"

/**
 * 「哪个用得最多」那几张表的一行。
 *
 * **只带 id，不带人话名。** 引擎的人话名归 `engines.available` 那份清单管
 * （第三方引擎的名字只有它知道），思考档的归 `effortLabel`。在这里再抄一份，
 * 就等于让统计口径去追一份随时会变的名单。
 */
export interface NameTally {
  id: string
  count: number
}

export interface ActivityTotals {
  tokens: number
  turns: number
  threads: number
  /** 你一共说了多少句。 */
  asks: number
  tools: number
  /** 弹到你面前、要你点的那些。自动放行的不算——它们本来就不进 transcript。 */
  approvals: number
  /** 子 agent、workflow、侧问，合起来多少条旁路。 */
  lanes: number
  /** 接力过多少次（一条会话里换了几回引擎）。 */
  handoffs: number
  /** 涉及多少个工作区。 */
  projects: number
  /** 单日最高。没有任何活动时缺席。 */
  peakDay?: ActivityDay
  /** 跨度最长的一条会话：从第一条记录到最后一条。 */
  longest?: { ms: number; title: string }
  activeDays: number
  /** 到今天为止的连续天数。今天还没动但昨天动过，仍然算连着。 */
  streak: number
  bestStreak: number
}

export interface ActivityDigest {
  /** 扫过多少条会话记录。 */
  threads: number
  /** 读不动、跳过的那几条。**要说出来**：数字少了一截总得有个原因。 */
  skipped: number
  /** 第一条 / 最后一条事件的时刻。一条记录都没有时缺席。 */
  since?: number
  until?: number
  /** 算这一份花了多久（毫秒）。界面用它决定要不要提醒「这一步要读盘」。 */
  ms: number
  /** **有活动的那些天**，按日期升序。没活动的日子不占一条，补零由界面做。 */
  days: readonly ActivityDay[]
  totals: ActivityTotals
  engines: readonly NameTally[]
  models: readonly NameTally[]
  efforts: readonly NameTally[]
  tools: readonly NameTally[]
  /** 你打过的斜杠命令。**按你输入的原文算**，不问引擎那边它叫什么。 */
  commands: readonly NameTally[]
  /**
   * 每家引擎各自报的累计用量。
   *
   * ## 为什么必须分开列，不能只给一个总数
   *
   * **各家的口径不是一回事。** 实测这台机器上：Claude 报的是一条原生会话里
   * 真正新增的 token（一整条长会话 250 万）；而 kimi 报的数字一条会话能到
   * **3.7 亿**——那是每次请求把整段上下文重新计一遍的算法，同一段历史被反复计入。
   * 把这两个数加起来得到的东西，既不是账单也不是工作量，**只是一个 omni 自己造的数**。
   *
   * 所以：总数照给（趋势有用），但**旁边永远摆着分家的那份**，让人一眼看出
   * 这个和那个不是同一种东西。这一条是「不给引擎自报的状态叠 omni 的猜测」
   * 在统计上的推论。
   */
  tokensByEngine: readonly NameTally[]
  /**
   * 跑过、但一次都没报过累计用量的引擎。
   *
   * **必须单独列出来。** 不列的话，一家从不报 `totalTokens` 的引擎会让整页看起来像
   * 「你几乎没用过它」——而事实是 omni 没有这个数字，两者差得远。
   */
  tokenless: readonly string[]
}
