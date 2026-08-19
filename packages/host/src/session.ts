import type { Command, Event, ItemId, Thread, ThreadId } from "@omni/protocol"
import type { Rule } from "@omni/approval"
import { createGate } from "./gate.js"
import { askUser } from "./approval.js"
import type { EngineSession } from "@omni/engine"
import { emit, type Ctx, type Live } from "./ctx.js"
import { evict } from "./live.js"
import { rememberEngineState, rememberHandle, rememberModel, rememberTrustApply } from "./engine-state.js"
import { copyTranscript } from "./transcript.js"
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
    // **临时的**：引擎照起（模型清单、斜杠命令要它才有），但在发出第一句话之前
    // 它不进侧栏、不落盘、切引擎当场生效（见 `Thread.provisional`）
    provisional: true,
    title: cmd.title ?? "新会话",
    ...(cmd.workspaceKind === undefined ? {} : { workspaceKind: cmd.workspaceKind }),
    cwd: cmd.cwd,
    engine: cmd.engine,
    trust: cmd.trust,
    status: "idle",
    createdAt: at,
    updatedAt: at,
    engineHistory: [cmd.engine],
    ...(cmd.model === undefined ? {} : { model: cmd.model }),
    ...(cmd.effort === undefined ? {} : { effort: cmd.effort }),
  }
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
  // 先腾地方再起新的：反过来的话峰值会多占一个会话的量（实测 260 MB）
  await evict(ctx, thread.id)
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
    // 不像句柄那样要处理「登记完成前就到达」：这几条只可能在开完会话之后到
    onModel: (model, effort) => {
      rememberModel(ctx, thread.id, model, effort)
    },
    onEngineState: (patch) => {
      rememberEngineState(ctx, thread.id, patch)
    },
    onTrustApply: (result) => {
      rememberTrustApply(ctx, thread.id, result)
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
        // **带上是谁报的**：一条会话中途会换引擎，而渲染层要认得出手上这份
        // 是不是当前这家的（见 store 的 `modelsOf`）
        emit(ctx, { type: "models.updated", at: ctx.deps.now(), threadId: thread.id, engine: thread.engine, models })
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
 * 建新的临时会话时，把上一条临时会话收掉。**一次只留一条。**
 *
 * 「新建」和「分叉 / 重来」都走这条：三者产出的都是**没说过话的会话**，
 * 而没说过话的会话随时可以再来一个（再分一次得到的东西一模一样），
 * 所以留着上一条没有价值，代价却是实打实的一个引擎进程。
 *
 * 临时会话不进侧栏（见 `Thread.provisional`），所以你一旦又点了一次「+」、
 * 或者切去别的会话，它就**再也点不回来**了——而它背后那个引擎进程还活着
 *（实测一条 codex 会话 260 MB）。看不见又回不去的东西不该继续占着进程。
 *
 * 它从来没上过磁盘（`Ctx.uncommitted`），所以「收掉」只是停进程 + 摘表，
 * 没有任何东西会丢。收不掉也不拦着新会话：一个停不掉的旧进程不该让你连
 * 新会话都开不出来。
 */
export async function dropTemps(ctx: Ctx, keep: readonly ThreadId[]): Promise<void> {
  for (const entry of [...ctx.live.values()]) {
    if (entry.thread.provisional !== true || keep.includes(entry.thread.id)) continue
    await remove(ctx, { type: "thread.delete", threadId: entry.thread.id }).catch(() => undefined)
  }
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
  // **先挂进待提交表再发事件**：新会话在发出第一句话之前不落盘，
  // 否则点一下「+」就在磁盘上留一条空会话，重启还在（见 `Ctx.uncommitted`）。
  // 只有「新建」走这条路——续跑和接管的会话本来就已经在磁盘上了。
  ctx.uncommitted.set(thread.id, [])
  emit(ctx, { type: "thread.started", at, thread: { ...thread, status: "starting" } })
  // 先腾地方再占地方：上一条临时会话这时已经点不回来了（见 `dropTemps`）
  await dropTemps(ctx, [thread.id])
  let early: string | undefined
  try {
    early = await launch(ctx, thread)
  } catch (error) {
    emit(ctx, { type: "thread.removed", at: ctx.deps.now(), threadId: thread.id })
    throw error
  }
  // 挑好的模型要在**第一句话发出去之前**落到引擎上（见 `thread.create` 的 `model`）。
  // 起不来就算了：模型没设上是个可以接着用的会话，为它把整条会话撤掉不成比例
  if (cmd.model !== undefined) {
    await ctx.live.get(thread.id)?.session.setModel(cmd.model, cmd.effort).catch(() => undefined)
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

/**
 * 改一条会话的信任档。
 *
 * ## 不活着的也要能改（和 `rename` 同一条道理）
 *
 * 上一版第一句就是「不在 `ctx.live` 里就 return」，于是对着一条 detached 的会话
 * 调它是**一个静默的空操作**：不报错、不发事件、什么都没发生。
 *
 * 那条路真有人走：手机上要把一条开在完全档的老会话接回来，必须先把它切到
 * 远程上限之内（`remote/policy.ts` 的注释里就写着「先在手机上把它切到 auto-edit」）——
 * 而它此刻正好不活。切不动的后果不是报错，是**接回来之后每一句话都被拒**，
 * 而用户在手机上遍寻不到任何能切档的地方。
 *
 * 所以照 `rename` 的样子办：活着就顺手告诉引擎一声，不活着也照样把这条记录改掉
 *（它会落盘，下次 `resume` 从日志里读回来的就是新档位）。
 */
export async function setTrust(ctx: Ctx, cmd: Extract<Command, { type: "thread.setTrust" }>): Promise<void> {
  const at = ctx.deps.now()
  const entry = ctx.live.get(cmd.threadId)
  if (entry !== undefined) {
    await entry.session.setTrust(cmd.trust)
    entry.thread = { ...entry.thread, trust: cmd.trust, updatedAt: at }
    emit(ctx, { type: "thread.updated", at, thread: entry.thread })
    return
  }
  // 不活着：从磁盘上那份记录改。**读不到就什么都不做**——
  // 凭空造一条只有档位的会话，比改不动糟得多
  const events = (await ctx.deps.journal?.read(cmd.threadId)) ?? []
  const record = [...events]
    .reverse()
    .find((e): e is Extract<Event, { type: "thread.started" | "thread.updated" }> =>
      e.type === "thread.started" || e.type === "thread.updated",
    )
  if (record === undefined) return
  emit(ctx, { type: "thread.updated", at, thread: { ...record.thread, trust: cmd.trust, updatedAt: at } })
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
  // **记引擎回报的那一档，不是请求的那个。** 两者会不一样：ZCode 的桥把
  // `thought` 报成「可选 low/high/max」而设进去必然报错，那一步失败不算换模型失败
  //（模型确实换了）——上一版把请求值原样记了下来，于是**界面显示「轻度」而引擎在 max**。
  // 界面照着这条记录画，所以这条记录必须是真的
  const applied = await entry.session.setModel(cmd.model, cmd.effort)
  const at = ctx.deps.now()
  // **强度要能被清掉。** 上一版是 `...(effort === undefined ? {} : {effort})`，
  // 于是换到一个不报强度的模型之后，旧模型的 `high` 永远留在记录上——
  // 界面照着它画一个引擎根本没在用的档位
  const rest = { ...entry.thread }
  delete rest.effort
  entry.thread = {
    ...rest,
    model: cmd.model,
    ...(applied.effort === undefined ? {} : { effort: applied.effort }),
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
  await fillTranscript(ctx, thread)
}

/**
 * 把引擎那边已有的对话搬进来。**搬不动就什么都不做**——那时界面上是空的，
 * 空态里那句说明会告诉用户内容在引擎那边（codex 走的就是这条路）。
 *
 * 截断了一定要说出来：一段被悄悄砍掉一半的历史，
 * 比一段明说「只搬了最近这些」糟得多。
 */
async function fillTranscript(ctx: Ctx, thread: Thread): Promise<void> {
  const entry = ctx.live.get(thread.id)
  const read = entry?.session.transcript
  if (entry === undefined || read === undefined) return
  const got = await read.call(entry.session).catch(() => undefined)
  if (got === undefined || got.items.length === 0) return
  copyTranscript(ctx, thread, got.items)
  if (got.total <= got.items.length) return
  ctx.deps.emit({
    type: "engine.status",
    at: ctx.deps.now(),
    threadId: thread.id,
    status: "degraded",
    detail: `这条会话有 ${String(got.total)} 条记录，只搬了最近 ${String(got.items.length)} 条进来。完整的还在引擎那边，它自己看得见。`,
  })
}
