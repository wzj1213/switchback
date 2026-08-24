/**
 * 第三栏开着哪几条旁路、正看哪一条。
 *
 * ## 关掉一个标签 ≠ 结束那条 lane
 *
 * 这是这个文件唯一真正要说清楚的事。标签是**看不看**，lane 是**跑不跑**——
 * 混了的话那颗「×」就变成了「杀掉子 agent」，而它长得一点都不像。
 * 所以这里全是纯粹的视图状态：关掉之后 lane 照跑，随时能从卡片再点开，
 * 树接着往下长。**这里没有任何一个函数能停掉引擎那边的东西。**
 *
 * ## 为什么存 id 数组不存布尔
 *
 * `useShell` 已有的 `comparing` / `settingsOpen` 那几个是布尔，因为它们只有一个。
 * 旁路可以同时开好几条，而「关掉再开应该回到刚才那条」要求记住 active。
 * 存布尔就得再存一个「上次是哪条」，而两个值什么时候同步、谁负责清，
 * 在两个组件之间说不清楚（`focusFilter` 当初改成计数器就是同一条教训）。
 */
export interface AsideTabs {
  /** 开着的标签，**按打开顺序**——界面上「先开的在左边」靠的就是这个。 */
  open: readonly string[]
  /** 正在看哪一条。空着 = 整栏收起。 */
  active: string | undefined
}

export const NO_TABS: AsideTabs = { open: [], active: undefined }

/** 打开一条；已经开着的只切过去，不重复加一个标签。 */
export function openTab(tabs: AsideTabs, laneId: string): AsideTabs {
  const open = tabs.open.includes(laneId) ? tabs.open : [...tabs.open, laneId]
  return { open, active: laneId }
}

/**
 * 关掉一条。
 *
 * 关的是当前那条时，焦点落到**右边那个**，没有右边就落到左边——和浏览器一样。
 * 全关完 `active` 变 undefined，整栏收起（`App` 据此不渲染第三列，
 * 而不是渲染一个宽度 0 的列：那里面 `Transcript` 仍然挂着、仍然跑贴底逻辑，
 * 是一份看不见的性能账）。
 */
export function closeTab(tabs: AsideTabs, laneId: string): AsideTabs {
  const at = tabs.open.indexOf(laneId)
  if (at < 0) return tabs
  const open = tabs.open.filter((id) => id !== laneId)
  if (tabs.active !== laneId) return { open, active: tabs.active }
  return { open, active: open[at] ?? open[at - 1] }
}

/**
 * 只留还存在的那些。
 *
 * 会话被删、换了引擎、或者回放到一个没有这条 lane 的时点之后，标签必须跟着消失——
 * 留着的是一个点了什么都没有的标签，而用户会以为那条支线还在。
 * **纯函数，在渲染时算**：让 `useShell` 去订阅 store 变化再清理，
 * 就得回答「谁负责在什么时候清」，那正是这一层不该有的问题。
 */
export function pruneTabs(tabs: AsideTabs, alive: ReadonlySet<string>): AsideTabs {
  if (tabs.open.every((id) => alive.has(id))) return tabs
  const open = tabs.open.filter((id) => alive.has(id))
  const active = tabs.active !== undefined && alive.has(tabs.active) ? tabs.active : open[open.length - 1]
  return { open, active }
}
