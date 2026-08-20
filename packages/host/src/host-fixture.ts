import { NO_CAPABILITIES, type EngineAxis, type Event, type Item } from "@omni/protocol"
import type { ApprovalAnswer, ApprovalAsk, EngineDriver, EngineSession } from "@omni/engine"
import type { Rule } from "@omni/approval"
import { createHost, type Host } from "./host.js"

export interface Fake {
  prompts: { text: string; turnId: string }[]
  disposed: boolean
  ask: (a: ApprovalAsk) => Promise<ApprovalAnswer>
  /** 驱动侧的出口。测试用它冒充引擎发事件，走宿主包装过的那条路。 */
  emit: (e: Event) => void
  /** 宿主传下来的续跑句柄。没传就是新会话。 */
  resume: string | undefined
  /** 驱动上报自己的会话句柄 */
  handle: (handle: string) => void
  /** 引擎**自己**换了模型 / 强度（ACP 的 `config_option_update` 那条路） */
  drift: (model?: string, effort?: string) => void
  /** 引擎自报当前状态（`current_mode_update` 那条路） */
  report: (patch: { axes?: readonly EngineAxis[]; modelId?: string }) => void
  /** 当前生效的记忆规则。取值函数——中途加的规则要立刻能读到。 */
  memory: () => readonly Rule[]
}

/** 引擎回报的强度怎么算。缺省 = 照单全收；传进来就是「它其实用的是这个」。 */
export type EffortOf = (effort?: string) => { effort?: string }

export function fakeDriver(
  effortOf?: EffortOf,
  aside = true,
): { driver: EngineDriver; session: () => Fake } {
  const holder: { fake: Fake | undefined } = { fake: undefined }
  const driver: EngineDriver = {
    id: "fake",
    start: (req) => {
      const fake: Fake = {
        prompts: [],
        disposed: false,
        ask: req.askUser,
        emit: req.emit,
        resume: req.resume,
        handle: (handle) => req.onHandle?.(handle),
        drift: (model, effort) => req.onModel?.(model, effort),
        report: (patch) => req.onEngineState?.(patch),
        memory: req.memory,
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
        ...(aside ? { askAside: (text: string) => Promise.resolve(`答：${text}`) } : {}),
        capabilities: () => NO_CAPABILITIES,
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

export function setup(options: { effort?: EffortOf; aside?: boolean } = {}): {
  host: Host
  events: Event[]
  session: () => Fake
} {
  const { driver, session } = fakeDriver(options.effort, options.aside ?? true)
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

export function setupTwoEngines(): TwoEngineRig {
  const stored: Event[] = []
  const sessions: Fake[] = []
  const driver = (id: string): EngineDriver => ({
    id,
    start: (req) => {
      const fake: Fake = {
        prompts: [],
        disposed: false,
        ask: req.askUser,
        emit: req.emit,
        resume: req.resume,
        handle: (h) => req.onHandle?.(h),
        drift: (model, effort) => req.onModel?.(model, effort),
        report: (patch) => req.onEngineState?.(patch),
        memory: req.memory,
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
        setModel: () => Promise.resolve({}),
        dispose: () => {
          fake.disposed = true
          return Promise.resolve()
        },
      })
    },
  })
  const events: Event[] = []
  const counter = { n: 0 }
  const host = createHost({
    drivers: { fake: driver("fake"), other: driver("other") },
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
  })
  return { host, events, sessions, stored }
}
