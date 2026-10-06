import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES, type Event } from "@switchback/protocol"
import type { EngineDriver, EngineSession } from "@switchback/engine"
import { createHost, type Host } from "./host.js"
import { setup, create, items, ask, type Fake } from "./host-fixture.js"

/**
 * 起引擎慢的那类驱动。真实的 codex 是 400ms——不长，但**不是零**，
 * 而界面必须在这 400ms 里已经有东西了。
 */
function slowDriver(delayMs: number, fail = false): EngineDriver {
  return {
    id: "slow",
    start: async () => {
      await new Promise((r) => setTimeout(r, delayMs))
      if (fail) throw new Error("引擎起不来")
      return {
        threadId: "t",
        prompt: () => Promise.resolve(),
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        askAside: (text: string) => Promise.resolve(`答：${text}`),
        capabilities: () => NO_CAPABILITIES,
        setModel: () => Promise.resolve({}),
        dispose: () => Promise.resolve(),
      }
    },
  }
}

function slowSetup(
  delayMs: number,
  fail = false,
): { host: Host; events: Event[]; starts: () => number } {
  const events: Event[] = []
  const counter = { n: 0, starts: 0 }
  const inner = slowDriver(delayMs, fail)
  const driver: EngineDriver = {
    id: "slow",
    start: (req) => {
      counter.starts += 1
      return inner.start(req)
    },
  }
  const host = createHost({
    drivers: { slow: driver },
    home: "/home/dev",
    emit: (e) => events.push(e),
    newId: (prefix) => {
      counter.n += 1
      return `${prefix}-${String(counter.n)}`
    },
    now: () => 0,
  })
  return { host, events, starts: () => counter.starts }
}

const slowCreate = { type: "thread.create", cwd: "/w", engine: "slow", trust: "auto-edit" } as const

describe("新建会话：先出现，再起引擎", () => {
  it("**引擎还没起完，会话就已经在事件流里了**——不然点下去几百毫秒毫无反应", async () => {
    const { host, events } = slowSetup(120)
    const pending = host.dispatch(slowCreate)
    // 不等它跑完就看
    await new Promise((r) => setTimeout(r, 30))
    const started = events.find((e) => e.type === "thread.started")
    expect(started?.type === "thread.started" ? started.thread.status : "").toBe("starting")
    await pending
  })

  it("引擎起好之后补一条 idle", async () => {
    const { host, events } = slowSetup(20)
    await host.dispatch(slowCreate)
    const updated = [...events].reverse().find((e) => e.type === "thread.updated")
    expect(updated?.type === "thread.updated" ? updated.thread.status : "").toBe("idle")
  })

  it("**引擎起不来就把那一行撤掉**——留一个永远 starting 的空壳比没有更糟", async () => {
    const { host, events } = slowSetup(10, true)
    await expect(host.dispatch(slowCreate)).rejects.toThrow("引擎起不来")
    expect(events.filter((e) => e.type === "thread.removed")).toHaveLength(1)
  })
})

describe("在途去重", () => {
  it("**连点三下只起一个引擎**——实测点三下真的会 spawn 三个 codex", async () => {
    const { host, starts } = slowSetup(60)
    await Promise.all([
      host.dispatch(slowCreate),
      host.dispatch(slowCreate),
      host.dispatch(slowCreate),
    ])
    expect(starts()).toBe(1)
  })

  it("上一次落定之后再建是允许的——**同一个目录开第二个会话是合法用法**", async () => {
    const { host, starts } = slowSetup(10)
    await host.dispatch(slowCreate)
    await host.dispatch(slowCreate)
    expect(starts()).toBe(2)
  })

  it("参数不同的新建以最后一次为准：尚未启动的旧配置安静取消", async () => {
    const { host, starts, events } = slowSetup(60)
    await Promise.all([
      host.dispatch(slowCreate),
      host.dispatch({ ...slowCreate, trust: "read-only" }),
    ])
    expect(starts()).toBe(1)
    expect(events.filter((event) => event.type === "thread.started")).toHaveLength(2)
    expect(events.filter((event) => event.type === "thread.removed")).toHaveLength(1)
  })

  it("同一条原生会话连点接管只起一个进程——两个 writer 会把其中一条永久卡住", async () => {
    const { host, starts, events } = slowSetup(60)
    const adopt = {
      type: "thread.adopt",
      engine: "slow",
      handle: "native-thread-1",
      cwd: "/w",
      title: "原生会话",
    } as const
    await Promise.all([host.dispatch(adopt), host.dispatch(adopt), host.dispatch(adopt)])
    expect(starts()).toBe(1)
    expect(events.filter((event) => event.type === "thread.started")).toHaveLength(1)
  })

  it("**失败也要放行**，否则一次失败就把这个键永久锁死", async () => {
    const { host, starts } = slowSetup(10, true)
    await expect(host.dispatch(slowCreate)).rejects.toThrow()
    await expect(host.dispatch(slowCreate)).rejects.toThrow()
    expect(starts()).toBe(2)
  })

  it("**上一轮跑完之后**再发是允许的——去重表不该把正常的追问也拦掉", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const first = events.find((e) => e.type === "thread.started")
    const threadId = first?.type === "thread.started" ? first.thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "一" })
    const turnId = session().prompts[0]?.turnId ?? ""
    session().emit({ type: "turn.completed", at: 0, turnId, status: "completed" })
    await host.dispatch({ type: "thread.prompt", threadId, text: "二" })
    expect(session().prompts.map((p) => p.text)).toEqual(["一", "二"])
  })

  it("**上一轮还在跑就不开新轮次**——覆盖 entry.turn 的话，引擎还在往旧 turnId 上发 item，正在流的回答会整个消失", async () => {
    // 硬约束没变，变的是没跑完时怎么办：以前抛错，现在排队（见「跑着的时候补一句话」那组）。
    // 这里钉的是那条硬约束本身：**第二句不能变成第二个 turn**
    const { host, events, session } = setup()
    await host.dispatch(create)
    const first = events.find((e) => e.type === "thread.started")
    const threadId = first?.type === "thread.started" ? first.thread.id : ""
    await host.dispatch({ type: "thread.prompt", threadId, text: "一" })
    await host.dispatch({ type: "thread.prompt", threadId, text: "二" })
    expect(session().prompts).toHaveLength(1)
    expect(events.filter((e) => e.type === "turn.started")).toHaveLength(1)
  })
})

describe("改名", () => {
  it("引擎标题更新自动标题位，但不冒充用户亲自命名", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    session().retitle("  原生标题  ")
    expect(host.live().find((t) => t.id === id)?.title).toBe("原生标题")
    expect(host.live().find((t) => t.id === id)?.named).toBeUndefined()
    expect(events.at(-1)).toMatchObject({ type: "thread.updated", thread: { title: "原生标题" } })
  })

  it("用户亲自起过名后，迟到的原生标题不能覆盖", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.rename", threadId: id, title: "我的名字" })
    session().retitle("引擎标题")
    expect(host.live().find((t) => t.id === id)?.title).toBe("我的名字")
  })

  it("发出 thread.renamed", async () => {
    const { host, events } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.rename", threadId: id, title: "改分页那个" })
    expect(events.filter((e) => e.type === "thread.renamed")).toHaveLength(1)
  })

  it("**不在内存里的会话也能改**——历史会话才是最需要改名的那批", async () => {
    const { host, events } = setup()
    await host.dispatch({ type: "thread.rename", threadId: "th-只在磁盘上", title: "旧账" })
    expect(events.find((e) => e.type === "thread.renamed")).toMatchObject({
      threadId: "th-只在磁盘上",
      title: "旧账",
    })
  })

  it("空名字不发事件——侧栏那一行会变成一块什么都不写的空白", async () => {
    const { host, events } = setup()
    await host.dispatch({ type: "thread.rename", threadId: "th-1", title: "   " })
    expect(events.filter((e) => e.type === "thread.renamed")).toHaveLength(0)
  })

  it("首尾空格剪掉", async () => {
    const { host, events } = setup()
    await host.dispatch({ type: "thread.rename", threadId: "th-1", title: "  两头有空格  " })
    expect(events.find((e) => e.type === "thread.renamed")).toMatchObject({ title: "两头有空格" })
  })

  it("改完之后 live 里那份也是新名字——不然接力/分叉会带着旧标题走", async () => {
    const { host, events } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.rename", threadId: id, title: "新名字" })
    expect(host.live().find((t) => t.id === id)?.title).toBe("新名字")
  })
})

describe("中断之后审批卡不能还挂着", () => {
  it("**中断时把待确认的审批落定**——否则事后点「允许」会写进永久规则，而那次调用早作废了", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "跑一下" })
    const pending = session().ask(ask)
    await new Promise((r) => setTimeout(r, 0))
    await host.dispatch({ type: "thread.interrupt", threadId: id })
    const turnId = events.find((e) => e.type === "turn.started")?.turn.id ?? ""
    session().emit({ type: "turn.completed", at: 1, turnId, status: "interrupted" })
    await new Promise((r) => setTimeout(r, 0))
    // 挂着的那次审批必须已经落定（按拒绝），驱动不会永远等在 canUseTool 里
    await expect(pending).resolves.toMatchObject({ allow: false })
  })

  it("正常跑完不动审批卡——那时候没有挂着的，扫一遍也不该有副作用", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "跑一下" })
    const turnId = events.find((e) => e.type === "turn.started")?.turn.id ?? ""
    session().emit({ type: "turn.completed", at: 1, turnId, status: "completed" })
    await new Promise((r) => setTimeout(r, 0))
    expect(host.live().find((t) => t.id === id)?.status).toBe("idle")
  })

  it("原生轮次提前报 completed 时，残留审批也按失效拒绝落定", async () => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "跑一下" })
    const pending = session().ask(ask)
    const turnId = events.find((e) => e.type === "turn.started")?.turn.id ?? ""
    session().emit({ type: "turn.completed", at: 1, turnId, status: "completed" })
    await expect(pending).resolves.toMatchObject({ allow: false })
    const card = items(events).filter((item) => item.kind === "approval").at(-1)
    expect(card?.kind === "approval" ? card.status : "").toBe("denied")
  })
})

describe("跑着的时候补一句话：排队，不是拒绝", () => {
  const run = async (): Promise<{
    host: Host
    events: Event[]
    session: () => Fake
    id: string
    turnId: string
  }> => {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    const turnId = events.find((e) => e.type === "turn.started")?.turn.id ?? ""
    return { host, events, session, id, turnId }
  }

  it("上一轮还在跑时再发一句，**不报错**，进队列", async () => {
    const { host, events, id } = await run()
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句" })
    const last = events.filter((e) => e.type === "thread.updated").at(-1)
    expect(last?.thread.queued).toEqual(["补一句"])
  })

  it("这一轮跑完，排队那句自动发出去", async () => {
    const { host, session, id, turnId } = await run()
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句" })
    session().emit({ type: "turn.completed", at: 1, turnId, status: "completed" })
    await new Promise((r) => setTimeout(r, 0))
    expect(session().prompts.map((p) => p.text)).toEqual(["第一句", "补一句"])
  })

  it("**一次只发一句**：跑完发第二句，第三句还在队里等", async () => {
    const { host, events, session, id, turnId } = await run()
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句" })
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "再补一句" })
    session().emit({ type: "turn.completed", at: 1, turnId, status: "completed" })
    await new Promise((r) => setTimeout(r, 0))
    expect(session().prompts.map((p) => p.text)).toEqual(["第一句", "补一句"])
    expect(events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued).toEqual([
      "再补一句",
    ])
  })

  it("**按停止就把队列作废**——「停完这句再跑下一句」不是任何人按停止时想要的", async () => {
    const { host, events, session, id } = await run()
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句" })
    await host.dispatch({ type: "thread.interrupt", threadId: id })
    expect(events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued).toEqual([])
    expect(session().prompts).toHaveLength(1)
  })

  it("中断结束的轮次不会把队列接着发出去", async () => {
    const { host, session, id, turnId } = await run()
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句" })
    session().emit({ type: "turn.completed", at: 1, turnId, status: "interrupted" })
    await new Promise((r) => setTimeout(r, 0))
    expect(session().prompts).toHaveLength(1)
  })
})

describe("跑着的时候补一句话：默认排队，插入是明确动作", () => {
  /**
   * 会 steer 的假引擎。**和上面那个共用不了**：它要能记下 steer 收到了什么、
   * 还要能让 steer 主动失败（那条竞态分支只有这样才测得到）。
   */
  const steerable = (): {
    host: Host
    events: Event[]
    steered: { text: string; attachments?: readonly string[] }[]
    prompts: { text: string }[]
    fail: { now: boolean }
  } => {
    const events: Event[] = []
    const steered: { text: string; attachments?: readonly string[] }[] = []
    const prompts: { text: string }[] = []
    const fail = { now: false }
    const counter = { n: 0 }
    const host = createHost({
      drivers: {
        fake: {
          id: "fake",
          start: (req) =>
            Promise.resolve({
              threadId: req.threadId,
              prompt: (text: string) => {
                prompts.push({ text })
                return Promise.resolve()
              },
              steer: (text: string, attachments?: readonly string[]) => {
                if (fail.now) return Promise.reject(new Error("那一轮刚好收工了"))
                steered.push({ text, ...(attachments === undefined ? {} : { attachments }) })
                return Promise.resolve()
              },
              interrupt: () => Promise.resolve(),
              setTrust: () => Promise.resolve({ restart: false }),
              models: () => Promise.resolve([]),
              capabilities: () => ({ compact: false, attachments: true, steer: true }),
              setModel: () => Promise.resolve({}),
              dispose: () => Promise.resolve(),
            } as unknown as EngineSession),
        },
      },
      home: "/home/dev",
      emit: (e) => events.push(e),
      newId: (prefix) => {
        counter.n += 1
        return `${prefix}-${String(counter.n)}`
      },
      now: () => 0,
    })
    return { host, events, steered, prompts, fail }
  }

  const running = async (h: ReturnType<typeof steerable>): Promise<string> => {
    await h.host.dispatch(create)
    const id = h.events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    return id
  }

  /**
   * **默认排队，哪怕引擎会 steer。** 这一条是和 codex 自己的行为对齐：
   * 在它的界面里打字回车那句是排着的，要再点一下才插进去。
   * 反过来（能插就插）的后果不是别扭，是「你以为在排队的那句，
   * 其实已经改变了它正在做的事」。
   */
  it("默认**进队列**，不碰正在跑的那一轮——即使引擎支持 steer", async () => {
    const h = steerable()
    const id = await running(h)
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "不对，用另一个文件" })
    expect(h.steered).toHaveLength(0)
    expect(h.events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued).toEqual([
      "不对，用另一个文件",
    ])
  })

  it("带 `steer` 才当场递进去（⌘⏎ 那条路）", async () => {
    const h = steerable()
    const id = await running(h)
    await h.host.dispatch({
      type: "thread.prompt",
      threadId: id,
      text: "不对，用另一个文件",
      steer: true,
    })
    expect(h.steered.map((s) => s.text)).toEqual(["不对，用另一个文件"])
    expect(h.events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued ?? []).toEqual(
      [],
    )
  })

  it("排队条上的「立刻插入」：把排着的几句合成一段递进去，**成功之后才清队列**", async () => {
    const h = steerable()
    const id = await running(h)
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "先别写" })
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "改用另一个文件" })
    await h.host.dispatch({ type: "thread.steerQueued", threadId: id })
    expect(h.steered.map((s) => s.text)).toEqual(["先别写\n改用另一个文件"])
    expect(h.events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued).toEqual([])
  })

  it("「立刻插入」失败时**队列原样留着**——那几句往往正是「别再往下走了」，丢不得", async () => {
    const h = steerable()
    const id = await running(h)
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "别再往下走了" })
    h.fail.now = true
    await h.host.dispatch({ type: "thread.steerQueued", threadId: id })
    expect(h.steered).toHaveLength(0)
    expect(h.events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued).toEqual([
      "别再往下走了",
    ])
  })

  it("**不开新轮次**——开了的话引擎还在往旧 turnId 上发 item，正在流的回答会整个消失", async () => {
    const h = steerable()
    const id = await running(h)
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句" })
    expect(h.events.filter((e) => e.type === "turn.started")).toHaveLength(1)
  })

  it("插进去的那句挂在**当前这一轮**上：transcript 里就该出现在它实际插话的位置", async () => {
    const h = steerable()
    const id = await running(h)
    const turnId = h.events.find((e) => e.type === "turn.started")?.turn.id
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句", steer: true })
    const said = items(h.events).filter((i) => i.kind === "user_message")
    expect(said.map((i) => i.text)).toEqual(["第一句", "补一句"])
    expect(said[1]?.turnId).toBe(turnId)
  })

  it("附件跟着一起递过去", async () => {
    const h = steerable()
    const id = await running(h)
    await h.host.dispatch({
      type: "thread.prompt",
      threadId: id,
      text: "看这张",
      attachments: ["/tmp/a.png"],
      steer: true,
    })
    expect(h.steered[0]?.attachments).toEqual(["/tmp/a.png"])
  })

  it("**递不进去就退回排队**，不报错——主因是那一轮刚好收工，而队列会立刻把它发出去", async () => {
    const h = steerable()
    const id = await running(h)
    h.fail.now = true
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "补一句", steer: true })
    expect(h.steered).toHaveLength(0)
    expect(h.events.filter((e) => e.type === "thread.updated").at(-1)?.thread.queued).toEqual([
      "补一句",
    ])
  })

  it("**递不进去时不留下幽灵消息**：先 steer 再发 item，顺序反了就会「你以为说过了」", async () => {
    const h = steerable()
    const id = await running(h)
    h.fail.now = true
    await h.host.dispatch({
      type: "thread.prompt",
      threadId: id,
      text: "没送出去的那句",
      steer: true,
    })
    expect(
      items(h.events)
        .filter((i) => i.kind === "user_message")
        .map((i) => i.text),
    ).toEqual(["第一句"])
  })

  it("没在跑的时候照常开新轮次，不走 steer", async () => {
    const h = steerable()
    await h.host.dispatch(create)
    const id = h.events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await h.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
    expect(h.prompts.map((p) => p.text)).toEqual(["第一句"])
    expect(h.steered).toHaveLength(0)
  })
})
