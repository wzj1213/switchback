import {
  NO_CAPABILITIES,
  type EngineAxis,
  type EngineGoal,
  type Event,
  type Item,
} from "@switchback/protocol"
import type { ApprovalAsk, EngineDriver, EngineSession, NativeTurnStart, StartRequest } from "@switchback/engine"
import type { Rule } from "@switchback/approval"
import { createHost, type Host } from "./host.js"
import type { HostDeps } from "./deps.js"

export interface Fake {
  prompts: { text: string; turnId: string }[]
  disposed: boolean
  ask: StartRequest["askUser"]
  question: StartRequest["askQuestion"]
  /** 驱动侧的出口。测试用它冒充引擎发事件，走宿主包装过的那条路。 */
  emit: (e: Event) => void
  /** 宿主传下来的续跑句柄。没传就是新会话。 */
  resume: string | undefined
  /** 驱动上报自己的会话句柄 */
  handle: (handle: string) => void
  /** 引擎自己生成会话标题。 */
  retitle: (title: string) => void
  /** 引擎**自己**换了模型 / 强度（ACP 的 `config_option_update` 那条路） */
  drift: (model?: string, effort?: string) => void
  /** 引擎自报当前状态（`current_mode_update` 那条路） */
  report: (patch: { axes?: readonly EngineAxis[]; modelId?: string }) => void
  /** 引擎原生长期目标的完整快照；undefined 表示清空。 */
  goal: (goal: EngineGoal | undefined) => void
  /** 引擎在空闲时按原生计划主动开启一轮。 */
  nativeTurn: (turn: NativeTurnStart) => string | undefined
  /** 当前生效的记忆规则。取值函数——中途加的规则要立刻能读到。 */
  memory: () => readonly Rule[]
  /** 压缩请求发出去过几次。「运行中不该发」靠它验。 */
  compacted: () => number
  /** 宿主给压缩操作铸的轮次；驱动必须用它回报异步结果。 */
  compactions: string[]
  /** 背后的原生进程或实时流没了（`StartRequest.onExit`）。 */
  exit: (detail: string) => void
}

/** 引擎回报的强度怎么算。缺省 = 照单全收；传进来就是「它其实用的是这个」。 */
export type EffortOf = (effort?: string) => { effort?: string } | Promise<{ effort?: string }>

export function fakeDriver(
  effortOf?: EffortOf, aside = true,
  asideAnswer: (text: string) => Promise<string> = (text) => Promise.resolve(`答：${text}`),
): { driver: EngineDriver; session: () => Fake } {
  const holder: { fake: Fake | undefined } = { fake: undefined }
  const driver: EngineDriver = {
    id: "fake",
    start: (req) => {
      const fake: Fake = {
        prompts: [],
        disposed: false,
        ask: req.askUser,
        question: req.askQuestion,
        emit: req.emit,
        resume: req.resume,
        handle: (handle) => req.onHandle?.(handle), retitle: (title) => req.onTitle?.(title),
        drift: (model, effort) => req.onModel?.(model, effort),
        report: (patch) => req.onEngineState?.(patch), goal: (goal) => req.onGoal?.(goal),
        nativeTurn: (turn) => req.onNativeTurn?.(turn), memory: req.memory,
        compacted: () => fake.compactions.length,
        compactions: [], exit: (detail) => req.onExit?.(detail),
      }
      holder.fake = fake
      const session: EngineSession = {
        threadId: req.threadId,
        prompt: (text, turnId) => {
          fake.prompts.push({ text, turnId })
          return Promise.resolve()
        },
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        // `aside: false` 演一家**不实现**侧问的引擎——它该抛，不该静默吞
        ...(aside ? { askAside: asideAnswer } : {}),
        capabilities: () => NO_CAPABILITIES,
        compact: (turnId) => {
          fake.compactions.push(turnId)
          req.emit({ type: "turn.completed", at: 1, turnId, status: "completed" })
          return Promise.resolve()
        },
        // 一个**认强度**的引擎：回报的就是收到的那个。设不上的那家靠 `effortOf` 演
        setModel: (_model: string, effort?: string) =>
          Promise.resolve(
            effortOf === undefined ? (effort === undefined ? {} : { effort }) : effortOf(effort),
          ),
        dispose: () => {
          fake.disposed = true
          return Promise.resolve()
        },
      }
      return Promise.resolve(session)
    },
  }
  return {
    driver,
    session: () => {
      const fake = holder.fake
      if (fake === undefined) throw new Error("会话还没建")
      return fake
    },
  }
}

export function setup(options: {
  effort?: EffortOf
  aside?: boolean
  asideAnswer?: (text: string) => Promise<string>
} = {}): {
  host: Host
  events: Event[]
  session: () => Fake
} {
  const { driver, session } = fakeDriver(
    options.effort,
    options.aside ?? true,
    options.asideAnswer,
  )
  const events: Event[] = []
  const counter = { n: 0 }
  const host = createHost({
    drivers: { fake: driver },
    home: "/home/dev",
    emit: (e) => events.push(e),
    newId: (prefix) => {
      counter.n += 1
      return `${prefix}-${String(counter.n)}`
    },
    now: () => 0,
  })
  return { host, events, session }
}

export const create = {
  type: "thread.create",
  cwd: "/w",
  engine: "fake",
  trust: "auto-edit",
} as const

export const items = (events: Event[]): Item[] =>
  events.filter((e) => e.type === "item.started" || e.type === "item.updated").map((e) => e.item)

export const ask: ApprovalAsk = {
  toolCallId: "toolu_1",
  tool: "Bash",
  summary: "git push",
  reason: "推送到远端不可逆",
}

/** 两家引擎的宿主。接力与分叉两节共用。 */
interface TwoEngineRig {
  host: Host
  events: Event[]
  sessions: Fake[]
  stored: Event[]
}

/** 两家引擎共用一份驱动壳，只有 id 不同。提出来是行数闸门逼的，边界本来也在这儿。 */
function twoEngineDriver(id: string, sessions: Fake[]): EngineDriver {
  return {
    id,
    start: (req) => {
      const fake: Fake = {
        prompts: [],
        disposed: false,
        ask: req.askUser,
        question: req.askQuestion,
        emit: req.emit,
        resume: req.resume,
        handle: (h) => req.onHandle?.(h),
        retitle: (title) => req.onTitle?.(title),
        drift: (model, effort) => req.onModel?.(model, effort),
        report: (patch) => req.onEngineState?.(patch),
        goal: (goal) => req.onGoal?.(goal),
        nativeTurn: (turn) => req.onNativeTurn?.(turn),
        memory: req.memory,
        compacted: () => fake.compactions.length,
        compactions: [],
        exit: (detail) => req.onExit?.(detail),
      }
      sessions.push(fake)
      return Promise.resolve({
        threadId: req.threadId,
        prompt: (text, turnId) => {
          fake.prompts.push({ text, turnId })
          return Promise.resolve()
        },
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        capabilities: () => NO_CAPABILITIES,
        compact: (turnId) => {
          fake.compactions.push(turnId)
          req.emit({ type: "turn.completed", at: 1, turnId, status: "completed" })
          return Promise.resolve()
        },
        setModel: () => Promise.resolve({}),
        dispose: () => {
          fake.disposed = true
          return Promise.resolve()
        },
      })
    },
  }
}

/** `extra` 补进宿主依赖：个别用例要一项可选依赖（例如交接说明）。 */
export function setupTwoEngines(extra: Partial<HostDeps> = {}): TwoEngineRig {
  const stored: Event[] = []
  const sessions: Fake[] = []
  const events: Event[] = []
  const counter = { n: 0 }
  const host = createHost({
    drivers: { fake: twoEngineDriver("fake", sessions), other: twoEngineDriver("other", sessions) },
    home: "/h",
    emit: (e) => events.push(e),
    newId: (p) => {
      counter.n += 1
      return `${p}-${String(counter.n)}`
    },
    now: () => 0,
    journal: {
      append: (_id, e) => {
        stored.push(e)
        return Promise.resolve()
      },
      read: () => Promise.resolve(stored),
      list: () => Promise.resolve([]),
      remove: () => Promise.resolve(),
      flush: () => Promise.resolve(),
    },
    ...extra,
  })
  return { host, events, sessions, stored }
}
