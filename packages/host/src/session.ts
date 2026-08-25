import type { Command, Event, Thread, ThreadId } from "@omni/protocol"
import type { Rule } from "@omni/approval"
import { createGate } from "./gate.js"
import { askQuestion } from "./question.js"
import { askUser } from "./approval.js"
import { attachStarted, discardUnstarted, drainQueued, emit, ensureLaunchable, isCurrent, preparingLive, type Ctx, type Live } from "./ctx.js"
import { evict } from "./live.js"
import {
  rememberHandle,
} from "./engine-state.js"
import { createItemScope } from "./item-scope.js"
import { withModel, withoutModel } from "./model.js"
import { dropPendingTemps } from "./pending.js"
import { applyEarly, earlySignals, type EarlySignals } from "./launch-signals.js"
import { signalCallbacks } from "./session-signals.js"

/**
 * 会话的生命周期：建、续跑、接力、发消息、改档、换模型、删。
 *
 * 从 `host.ts` 拆出来是因为那个文件撑过了 300 行闸门——但拆完读起来确实更顺：
 * `host.ts` 只剩「事件怎么出去、命令怎么分派」，这里是「一个会话怎么活」。
 */

function newThread(
  cmd: Extract<Command, { type: "thread.create" }>,
  id: ThreadId,
  at: number,
): Thread {
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
interface LaunchOptions {
  resume?: string
  forkOf?: { handle: string; dropTurns?: number }
  captureBaseline?: boolean
  beforeActivate?: (entry: Live) => void | Promise<void>
}

type InstallLease = Live["lease"] & { installing: boolean; early: EarlySignals }
interface Installation { lease: InstallLease; beforeActivate: LaunchOptions["beforeActivate"] }

function failInstall(lease: InstallLease, error: unknown): never {
  Object.assign(lease, { active: false, installing: false })
  throw error
}

async function installStarted(
  ctx: Ctx,
  live: Live,
  session: Live["session"],
  installation: Installation,
): Promise<void> {
  const { lease, beforeActivate } = installation
  await attachStarted(ctx, live, session)
  const readyStatus = live.thread.status
  try {
    live.gate = createGate((event) => {
      if (isCurrent(ctx, live)) emit(ctx, event)
    })
    live.thread = {
      ...live.thread,
      status: "starting",
      capabilities: session.capabilities(),
      ...(session.profile === undefined ? {} : { engineProfile: session.profile }),
    }
    live.thread = applyEarly(live.thread, lease.early, ctx.deps.now())
    ctx.live.set(live.thread.id, live)
    await beforeActivate?.(live)
    await session.activate?.()
    if (live.thread.status === "starting" && readyStatus !== "starting") {
      live.thread = { ...live.thread, status: readyStatus }
    }
    lease.installing = false
  } catch (error) {
    lease.active = false
    lease.installing = false
    if (ctx.live.get(live.thread.id)?.lease === live.lease) ctx.live.delete(live.thread.id)
    await session.dispose().catch(() => undefined)
    throw error
  }
}

function clearSessionState(ctx: Ctx, thread: Thread): void {
  const at = ctx.deps.now()
  emit(ctx, { type: "models.updated", at, threadId: thread.id, engine: thread.engine, models: [] })
  emit(ctx, { type: "commands.updated", at, threadId: thread.id, engine: thread.engine, commands: [] })
  emit(ctx, { type: "usage.cleared", at, threadId: thread.id, engine: thread.engine })
}

export async function launch(ctx: Ctx, thread: Thread, options: LaunchOptions = {}): Promise<string | undefined> {
  const { resume, forkOf, captureBaseline = true, beforeActivate } = options
  const driver = ctx.deps.drivers[thread.engine]
  if (driver === undefined) throw new Error(`未注册的引擎：${thread.engine}`)
  // 必须在引擎能动工作区之前取样；接力/权限重启沿用同一个 thread id，自然复用。
  await ensureLaunchable(ctx, thread, captureBaseline)
  // 同一个 thread 会接力、续跑和权限重启。新进程尚未报目录时，上一进程的模型与
  // 斜杠命令都不能继续冒充可用；先发空清单，之后只接受新会话自己的上报。
  clearSessionState(ctx, thread)
  // 先腾地方再起新的：反过来的话峰值会多占一个会话的量（实测 260 MB）
  if (!ctx.live.has(thread.id)) await evict(ctx, thread.id)
  const itemScope = createItemScope(ctx.deps.newId)
  const lease = { active: true, installing: true, early: earlySignals() }
  // 先建条目再起引擎：驱动可能在 start() 里就回调，那时得能读到规则表
  const rules = [...((await ctx.deps.rules?.read(thread.cwd)) ?? [])] as Rule[]
  const live = preparingLive(thread, lease, rules)
  const session = await driver.start({
    threadId: thread.id,
    cwd: thread.cwd,
    trust: thread.trust,
    home: ctx.deps.home,
    memory: () => live.rules,
    emit: (event) => {
      if ((lease.installing && !ctx.closed && !ctx.removed.has(thread.id)) || isCurrent(ctx, live)) {
        emit(ctx, itemScope.event(event))
      }
    },
    askUser: (ask, wait) =>
      isCurrent(ctx, live)
        ? askUser(ctx, thread.id, itemScope.ask(ask, live.turn), wait)
        : Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: (questions, wait) =>
      isCurrent(ctx, live) ? askQuestion(ctx, thread.id, questions, wait) : Promise.resolve({ dismissed: true }),
    ...signalCallbacks(ctx, live, thread.id, lease),
    ...(thread.engineProfile === undefined ? {} : { profile: thread.engineProfile }),
    ...(resume === undefined ? {} : { resume }),
    ...(forkOf === undefined ? {} : { forkOf }),
  }).catch((error: unknown) => failInstall(lease, error))
  // 能力握手时问一次就够；接入前任一步抛错都由这里销毁已经启动的 session。
  await installStarted(ctx, live, session, { lease, beforeActivate })
  askCatalogs(ctx, live)
  return lease.early.handle
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
function catalog<T>(
  ctx: Ctx,
  entry: Live,
  load: () => Promise<T> | undefined,
  accept: (value: T) => void,
): void {
  void Promise.resolve()
    .then(load)
    .then((value) => {
      if (value !== undefined && isCurrent(ctx, entry)) accept(value)
    })
    .catch(() => undefined)
}

function askCatalogs(ctx: Ctx, entry: Live): void {
  const { thread, session } = entry
  // 模型清单要现问引擎——各家的可选项由它们自己的账号与配置决定，
  // omni 写死一份清单迟早会和实际能用的对不上。
  catalog(ctx, entry, () => session.models(), (models) => {
    if (models.length > 0) {
        // **带上是谁报的**：一条会话中途会换引擎，而渲染层要认得出手上这份
        // 是不是当前这家的（见 store 的 `modelsOf`）
      emit(ctx, {
        type: "models.updated",
        at: ctx.deps.now(),
        threadId: thread.id,
        engine: thread.engine,
        models,
      })
    }
  })
  // 斜杠命令同理，而且更不能写死：**那里面大半是用户自己装的技能**。
  // 和模型分两次问、各自失败各自算——一家拿不到模型不该连命令也没有
  catalog(ctx, entry, () => session.commands?.(), (commands) => {
    if (commands.length > 0) {
      emit(ctx, {
        type: "commands.updated",
        at: ctx.deps.now(),
        threadId: thread.id,
        engine: thread.engine,
        commands,
      })
    }
  })
  // 引擎自己存着的会话、以及它登录的账号。**各自失败各自算**——
  // 和模型、命令一样，一样拿不到不该连累另一样
  catalog(ctx, entry, () => session.history?.(), (threads) => {
    if (threads.length > 0) {
      emit(ctx, { type: "engine.history", at: ctx.deps.now(), engine: thread.engine, threads })
    }
  })
  catalog(ctx, entry, () => session.account?.(), (account) => {
    if (account !== undefined) {
      emit(ctx, { type: "account.updated", at: ctx.deps.now(), engine: thread.engine, account })
    }
  })
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
  // 还卡在 driver.start 的临时会话不在 live 表里，但同样已经被下一次新建取代。
  await dropPendingTemps(ctx, keep)
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
export async function create(
  ctx: Ctx,
  cmd: Extract<Command, { type: "thread.create" }>,
): Promise<void> {
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
    const superseded = ctx.removed.has(thread.id)
    await discardUnstarted(ctx, thread.id)
    // 后一条临时会话已经取代了这一条时，这是正常取消，不该再冒一条错误横幅。
    if (superseded) return
    emit(ctx, { type: "thread.removed", at: ctx.deps.now(), threadId: thread.id })
    throw error
  }
  // 挑好的模型要在**第一句话发出去之前**落到引擎上（见 `thread.create` 的 `model`）。
  // 起不来就算了：模型没设上是个可以接着用的会话，为它把整条会话撤掉不成比例
  if (cmd.model !== undefined) {
    const entry = ctx.live.get(thread.id)
    if (entry !== undefined) {
      const applied = await entry.session.setModel(cmd.model, cmd.effort).catch(() => undefined)
      if (isCurrent(ctx, entry)) {
        entry.thread = applied === undefined
          ? withoutModel(entry.thread)
          : withModel(entry.thread, cmd.model, applied, ctx.deps.now())
      }
    }
  }
  if (ctx.removed.has(thread.id)) return
  // **发 `live` 里那一份，不是这个局部变量**——`launch` 期间会往上面挂东西
  //（现在是引擎能力）。发局部的那份等于把它们原地丢掉，而且一声不响
  emit(ctx, {
    type: "thread.updated",
    at: ctx.deps.now(),
    thread: ctx.live.get(thread.id)?.thread ?? thread,
  })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)
  drainQueued(ctx, ctx.live.get(thread.id))
}

/**
 * 让一个从磁盘回放出来的会话重新接上引擎。
 *
 * 会话记录只在渲染层（回放不经过宿主），所以这里要**自己从日志里把它读回来**。
 * 没有句柄就不给续——那种情况下起的是个全新会话，模型对上面那段对话一无所知，
 * 而界面看起来像是接上了。**宁可报错也不要制造这种错觉。**
 */
export async function resume(
  ctx: Ctx,
  cmd: Extract<Command, { type: "thread.resume" }>,
): Promise<void> {
  if (ctx.live.has(cmd.threadId)) return
  const events = (await ctx.deps.journal?.read(cmd.threadId)) ?? []
  const record = [...events]
    .reverse()
    .find(
      (e): e is Extract<Event, { type: "thread.started" | "thread.updated" }> =>
        e.type === "thread.started" || e.type === "thread.updated",
    )
  if (record === undefined) throw new Error(`找不到会话 ${cmd.threadId} 的历史，无法续跑`)
  const handle = record.thread.engineHandle
  if (handle === undefined) {
    throw new Error("这个会话没有留下引擎侧的句柄（可能是旧版本记录），只能新建会话继续")
  }
  const at = ctx.deps.now()
  const thread: Thread = { ...record.thread, detached: false, status: "idle", updatedAt: at }
  // 旧任务没有保存过基线时不能在这里现抓一份，再把“续跑时刻”冒充整段对话开场。
  // 已有基线由桌面存储直接复用；没有就诚实退回 legacy 工作区差异。
  const early = await launch(ctx, thread, { resume: handle, captureBaseline: false })
  emit(ctx, {
    type: "thread.updated",
    at: ctx.deps.now(),
    thread: ctx.live.get(thread.id)?.thread ?? thread,
  })
  if (early !== undefined) rememberHandle(ctx, thread.id, early)
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

export async function setModel(
  ctx: Ctx,
  cmd: Extract<Command, { type: "thread.setModel" }>,
): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined || !isCurrent(ctx, entry)) return
  // **记引擎回报的那一档，不是请求的那个。** 两者会不一样：ZCode 的桥把
  // `thought` 报成「可选 low/high/max」而设进去必然报错，那一步失败不算换模型失败
  //（模型确实换了）——上一版把请求值原样记了下来，于是**界面显示「轻度」而引擎在 max**。
  // 界面照着这条记录画，所以这条记录必须是真的
  const applied = await entry.session.setModel(cmd.model, cmd.effort)
  // 等引擎回包时可能已经接力到另一家；旧回包不能把新会话重新画成上一家的模型。
  if (!isCurrent(ctx, entry)) return
  const at = ctx.deps.now()
  // **强度要能被清掉。** 上一版是 `...(effort === undefined ? {} : {effort})`，
  // 于是换到一个不报强度的模型之后，旧模型的 `high` 永远留在记录上——
  // 界面照着它画一个引擎根本没在用的档位
  entry.thread = withModel(entry.thread, cmd.model, applied, at)
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * 关掉会话并把记录从磁盘上删掉。
 *
 * 顺序是有讲究的：**先落定挂着的审批，再 dispose，最后才删文件**。
 * 反过来的话，一个还在等审批的驱动会卡在那里，而它的日志文件已经没了——
 * 之后它写的每一条都会把文件重新建出来，删除等于没删。
 *
 * 对回放出来的会话（宿主这边没有登记）同样有效：直接删文件即可。
 */
export async function remove(
  ctx: Ctx,
  cmd: Extract<Command, { type: "thread.delete" }>,
): Promise<void> {
  ctx.removed.add(cmd.threadId)
  const entry = ctx.live.get(cmd.threadId)
  if (entry !== undefined) {
    entry.gate.settleAll()
    entry.lease.active = false
    // **在 dispose 之前**——进程都没了就发不出去了。
    // 归档不是删除：引擎那边的原始记录是用户的，可逆的操作才轮得到我们替他做
    await entry.session.discard?.().catch(() => undefined)
    // 驱动清理失败不能阻止本地记录与基线删除；墓碑已经落下，旧回调也无法再复活它。
    await entry.session.dispose().catch(() => undefined)
    ctx.live.delete(cmd.threadId)
  }
  await ctx.deps.journal?.remove(cmd.threadId)
  await ctx.deps.removeWorktreeBaseline?.(cmd.threadId)
  emit(ctx, { type: "thread.removed", at: ctx.deps.now(), threadId: cmd.threadId })
}
