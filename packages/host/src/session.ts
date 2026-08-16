import type { Command, Event, ItemId, Thread, ThreadId } from "@omni/protocol"
import type { Rule } from "@omni/approval"
import { createGate } from "./gate.js"
import { askUser } from "./approval.js"
import type { EngineSession } from "@omni/engine"
import { emit, type Ctx, type Live } from "./ctx.js"
import type { Gate } from "./gate.js"

/**
 * 会话的生命周期：建、续跑、接力、发消息、改档、换模型、删。
 *
 * 从 `host.ts` 拆出来是因为那个文件撑过了 300 行闸门——但拆完读起来确实更顺：
 * `host.ts` 只剩「事件怎么出去、命令怎么分派」，这里是「一个会话怎么活」。
 */

function newThread(cmd: Extract<Command, { type: "thread.create" }>, id: ThreadId, at: number): Thread {
  return {
    id,
    title: cmd.title ?? "新会话",
    ...(cmd.workspaceKind === undefined ? {} : { workspaceKind: cmd.workspaceKind }),
    cwd: cmd.cwd,
    engine: cmd.engine,
    trust: cmd.trust,
    status: "idle",
    createdAt: at,
    updatedAt: at,
    engineHistory: [cmd.engine],
  }
}

/**
 * 记下引擎那边的会话句柄。
 *
 * 走 `thread.updated` 而不是私存一份：那样它才会跟着事件流落盘，
 * 下次启动读回来就在 `Thread` 上——**续跑需要的东西必须和历史存在同一个地方**，
 * 否则总有一天会出现「历史在但句柄丢了」。
 */
export function rememberHandle(ctx: Ctx, id: ThreadId, handle: string): void {
  const entry = ctx.live.get(id)
  if (entry === undefined || entry.thread.engineHandle === handle) return
  const at = ctx.deps.now()
  entry.thread = { ...entry.thread, engineHandle: handle, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * 起一个引擎会话并登记。`resume` 有值就是续跑。
 *
 * 返回**在登记完成之前就到达的句柄**。codex 在 `start()` 里就知道自己的 thread id，
 * 那时候 `ctx.live` 还没有这条会话，`rememberHandle` 会扑空——
 * 这个洞第一次跑真实会话才现形（落盘里根本没有 `engineHandle`）。
 * 交给调用方在发完自己的事件之后补上，顺序才是「started → updated」。
 */
export async function launch(
  ctx: Ctx,
  thread: Thread,
  resume?: string,
  forkOf?: { handle: string; dropTurns?: number },
): Promise<string | undefined> {
  const driver = ctx.deps.drivers[thread.engine]
  if (driver === undefined) throw new Error(`未注册的引擎：${thread.engine}`)
  const early: { handle: string | undefined } = { handle: undefined }
  // 先建条目再起引擎：驱动可能在 start() 里就回调，那时得能读到规则表
  const live: Live = {
    thread,
    session: undefined as unknown as EngineSession,
    gate: undefined as unknown as Gate,
    turn: undefined,
    rules: [...((await ctx.deps.rules?.read(thread.cwd)) ?? [])] as Rule[],
    suggests: new Map<ItemId, Rule>(),
    queued: [],
  }
  const session = await driver.start({
    threadId: thread.id,
    cwd: thread.cwd,
    trust: thread.trust,
    home: ctx.deps.home,
    memory: () => live.rules,
    emit: (event) => {
      emit(ctx, event)
    },
    askUser: (ask) => askUser(ctx, thread.id, ask),
    onHandle: (handle) => {
      if (ctx.live.has(thread.id)) rememberHandle(ctx, thread.id, handle)
      else early.handle = handle
    },
    ...(resume === undefined ? {} : { resume }),
    ...(forkOf === undefined ? {} : { forkOf }),
  })
  live.session = session
  live.gate = createGate((e) => {
    emit(ctx, e)
  })
  // 能力握手时问一次就够——它不随轮次变。挂到 thread 上，
  // 界面只看它，不看引擎叫什么名字
  live.thread = { ...live.thread, capabilities: session.capabilities() }
  ctx.live.set(thread.id, live)
  askCatalogs(ctx, thread, session)
  return early.handle
}

/**
 * 握手完向引擎要的那几份清单：能选哪些模型、认哪些斜杠命令、
 * 它自己存着哪些会话、登录的是哪个账号。
 *
 * **四件事各问各的、各自失败各自算**，一件都不 await。理由是同一条：
 * 它们全都是锦上添花，而 `launch` 返回意味着「这个会话可以用了」——
 * 让一份清单拖着会话起不来，是拿主线换支线。
 * 拿不到就是拿不到，界面据此少画一块，不报错。
 *
 * **绝不写死任何一份**：模型由账号与配置决定，斜杠命令里大半是用户自己装的技能，
 * 会话清单更是随时在变。写死的表第二天就过期，而且过期了不报错。
 */
function askCatalogs(ctx: Ctx, thread: Thread, session: EngineSession): void {
  // 模型清单要现问引擎——各家的可选项由它们自己的账号与配置决定，
  // omni 写死一份清单迟早会和实际能用的对不上。
  void session
    .models()
    .then((models) => {
      if (models.length > 0) {
        emit(ctx, { type: "models.updated", at: ctx.deps.now(), threadId: thread.id, models })
      }
    })
    .catch(() => undefined)
  // 斜杠命令同理，而且更不能写死：**那里面大半是用户自己装的技能**。
  // 和模型分两次问、各自失败各自算——一家拿不到模型不该连命令也没有
  void session
    .commands?.()
    .then((commands) => {
      if (commands.length > 0) {
        emit(ctx, { type: "commands.updated", at: ctx.deps.now(), threadId: thread.id, commands })
      }
    })
    .catch(() => undefined)
  // 引擎自己存着的会话、以及它登录的账号。**各自失败各自算**——
  // 和模型、命令一样，一样拿不到不该连累另一样
  void session
    .history?.()
    .then((threads) => {
      if (threads.length > 0) {
        emit(ctx, { type: "engine.history", at: ctx.deps.now(), engine: thread.engine, threads })
      }
    })
    .catch(() => undefined)
  void session
    .account?.()
    .then((account) => {
      if (account !== undefined) {
        emit(ctx, { type: "account.updated", at: ctx.deps.now(), engine: thread.engine, account })
      }
    })
    .catch(() => undefined)
}

/**
 * 开一个新会话。
 *
 * **先让它出现在界面上，再去起引擎。** 上一版的顺序反过来：
 * `await launch()` 走完整个 spawn + 握手才 emit，于是点下去到列表里出现那一行
 * 之间界面上什么都没有——没有加载态、没有禁用、什么都没有，
 * 用户唯一能做的就是再点一下。实测点三下真的会起三个 codex 进程。
 *
 * 现在分两步：`starting` 那条立刻出去（界面上有了、输入框是禁的），
 * 引擎起好再补一条 `idle`。**起不来就把它撤掉**——留一个永远 starting 的
 * 空壳比没有更糟，而错误由调用方翻成横幅。
 */
export async function create(ctx: Ctx, cmd: Extract<Command, { type: "thread.create" }>): Promise<void> {
  const at = ctx.deps.now()
  const thread = newThread(cmd, ctx.deps.newId("th"), at)
  emit(ctx, { type: "thread.started", at, thread: { ...thread, status: "starting" } })
  let early: string | undefined
  try {
    early = await launch(ctx, thread)
  } catch (error) {
    emit(ctx, { type: "thread.removed", at: ctx.deps.now(), threadId: thread.id })
    throw error
  }
  // **发 `live` 里那一份，不是这个局部变量**——`launch` 期间会往上面挂东西
  //（现在是引擎能力）。发局部的那份等于把它们原地丢掉，而且一声不响
  emit(ctx, { type: "thread.updated", at: ctx.deps.now(), thread: ctx.live.get(thread.id)?.thread ?? thread })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)
}

/**
 * 让一个从磁盘回放出来的会话重新接上引擎。
 *
 * 会话记录只在渲染层（回放不经过宿主），所以这里要**自己从日志里把它读回来**。
 * 没有句柄就不给续——那种情况下起的是个全新会话，模型对上面那段对话一无所知，
 * 而界面看起来像是接上了。**宁可报错也不要制造这种错觉。**
 */
export async function resume(ctx: Ctx, cmd: Extract<Command, { type: "thread.resume" }>): Promise<void> {
  if (ctx.live.has(cmd.threadId)) return
  const events = (await ctx.deps.journal?.read(cmd.threadId)) ?? []
  const record = [...events]
    .reverse()
    .find((e): e is Extract<Event, { type: "thread.started" | "thread.updated" }> =>
      e.type === "thread.started" || e.type === "thread.updated",
    )
  if (record === undefined) throw new Error(`找不到会话 ${cmd.threadId} 的历史，无法续跑`)
  const handle = record.thread.engineHandle
  if (handle === undefined) {
    throw new Error("这个会话没有留下引擎侧的句柄（可能是旧版本记录），只能新建会话继续")
  }
  const at = ctx.deps.now()
  const thread: Thread = { ...record.thread, detached: false, status: "idle", updatedAt: at }
  const early = await launch(ctx, thread, handle)
  emit(ctx, { type: "thread.updated", at, thread })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)
}

export async function setTrust(ctx: Ctx, cmd: Extract<Command, { type: "thread.setTrust" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) return
  await entry.session.setTrust(cmd.trust)
  const at = ctx.deps.now()
  entry.thread = { ...entry.thread, trust: cmd.trust, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * 改名。
 *
 * **不要求会话还活着**——历史会话才是最需要改名的：默认标题取自第一句提问
 * （「帮我看看这个报错…」），而三天后你找它时想的是「那个改分页的」。
 * 所以这里不走 `ctx.live` 必须存在那条路，活着就顺手更新一份，不活着照样发事件。
 */
export function rename(ctx: Ctx, cmd: Extract<Command, { type: "thread.rename" }>): Promise<void> {
  const title = cmd.title.trim()
  // 空名字不接受：侧栏那一行会变成一块什么都不写的空白，比原来的标题糟得多
  if (title === "") return Promise.resolve()
  const at = ctx.deps.now()
  const entry = ctx.live.get(cmd.threadId)
  if (entry !== undefined) {
    entry.thread = { ...entry.thread, title, named: true, updatedAt: at }
    // 引擎那边也存着一份会话列表。**不传的话同一条会话在两处叫不同名字**，
    // 而你正是要靠名字找到它。传不过去不影响 omni 侧改名，所以吞掉错误
    void entry.session.setTitle?.(title).catch(() => undefined)
  }
  emit(ctx, { type: "thread.renamed", at, threadId: cmd.threadId, title })
  return Promise.resolve()
}

export async function setModel(ctx: Ctx, cmd: Extract<Command, { type: "thread.setModel" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) return
  await entry.session.setModel(cmd.model, cmd.effort)
  const at = ctx.deps.now()
  // **强度要能被清掉。** 上一版是 `...(effort === undefined ? {} : {effort})`，
  // 于是换到一个不报强度的模型之后，旧模型的 `high` 永远留在记录上——
  // 界面照着它画一个引擎根本没在用的档位
  const rest = { ...entry.thread }
  delete rest.effort
  entry.thread = {
    ...rest,
    model: cmd.model,
    ...(cmd.effort === undefined ? {} : { effort: cmd.effort }),
    updatedAt: at,
  }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * L3 分叉：同一个目标，换一家再跑一遍。
 *
 * 和接力（L2）**只差一件事**：原会话不停。所以代码上也只差一件事——
 * 不 dispose 旧的、不复用旧的 thread id。
 *
 * 交的还是那份交接包，但语义不同：接力是「接着做」，分叉是「你也做一遍」。
 * 所以只取**目标**，不带「已改动的文件」——那会让第二家以为活已经干了一半。
 */
/**
 * 分叉：同一个目标交给另一家，另起一个会话，原会话保留。
 *
 * **两个会话共用同一个工作区。** 所以后跑的那家会看见先跑的改动——
 * 实测过：Codex 先把 JSDoc 补完，Claude 接着跑，如实回答「已经有了，不用补」。
 *
 * 这是当前的语义，不是 bug；但它很容易被读成一次对照实验，
 * 于是得出「Claude 什么都没干」这种完全错误的结论。对比视图
 * （`Compare.tsx`）在 cwd 相同时会把这句话直接写在界面上。
 *
 * 真要做对照，得让两边各拿一份工作区副本（git worktree 之类）——那是另一件事。
 */
/**
 * 关掉会话并把记录从磁盘上删掉。
 *
 * 顺序是有讲究的：**先落定挂着的审批，再 dispose，最后才删文件**。
 * 反过来的话，一个还在等审批的驱动会卡在那里，而它的日志文件已经没了——
 * 之后它写的每一条都会把文件重新建出来，删除等于没删。
 *
 * 对回放出来的会话（宿主这边没有登记）同样有效：直接删文件即可。
 */
export async function remove(ctx: Ctx, cmd: Extract<Command, { type: "thread.delete" }>): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry !== undefined) {
    entry.gate.settleAll()
    // **在 dispose 之前**——进程都没了就发不出去了。
    // 归档不是删除：引擎那边的原始记录是用户的，可逆的操作才轮得到我们替他做
    await entry.session.discard?.().catch(() => undefined)
    await entry.session.dispose()
    ctx.live.delete(cmd.threadId)
  }
  await ctx.deps.journal?.remove(cmd.threadId)
  emit(ctx, { type: "thread.removed", at: ctx.deps.now(), threadId: cmd.threadId })
}

/**
 * 把**引擎自己存的**一条会话接过来，在 omni 里接着聊。
 *
 * ## 和 `resume` 的区别
 *
 * `resume` 接的是 omni 建过、日志在自己这儿的会话：内容都在，接上引擎就完事。
 * 这里接的是 omni **从来不知道存在**的会话——你在终端里、在别的界面里跑的。
 * 所以工作区、标题都得从引擎的列表里带过来，omni 这边是从零开一条记录。
 *
 * ## transcript 会是空的，而且必须说出来
 *
 * codex 的 `thread/items/list` 目前明确回 `not supported yet`（实测），
 * 所以历史内容**取不回来**。引擎那边记得一切，omni 这边一片空白。
 * 这正是分叉那次特意避免的「看起来丢了但其实没丢」——那次能抄所以抄了，
 * 这次抄不了，就只能在界面上讲清楚（`adopted` 标记，空态里说明）。
 * 假装什么都没发生是最坏的选择。
 */
export async function adopt(ctx: Ctx, cmd: Extract<Command, { type: "thread.adopt" }>): Promise<void> {
  const at = ctx.deps.now()
  const thread: Thread = {
    id: ctx.deps.newId("th"),
    title: cmd.title,
    cwd: cmd.cwd,
    engine: cmd.engine,
    // 接过来的会话沿用默认档，不猜它当初在引擎里是什么档——
    // 猜错的方向如果是放宽，代价是它在一个你没同意的档位上动手
    trust: "auto-edit",
    status: "starting",
    createdAt: at,
    updatedAt: at,
    engineHistory: [cmd.engine],
    engineHandle: cmd.handle,
    adopted: true,
  }
  emit(ctx, { type: "thread.started", at, thread })
  try {
    await launch(ctx, thread, cmd.handle)
  } catch (error) {
    // 接不上就撤掉：留一个永远 starting 的空壳比没有更糟
    emit(ctx, { type: "thread.removed", at: ctx.deps.now(), threadId: thread.id })
    throw error
  }
  emit(ctx, {
    type: "thread.updated",
    at: ctx.deps.now(),
    thread: { ...(ctx.live.get(thread.id)?.thread ?? thread), status: "idle" },
  })
}
