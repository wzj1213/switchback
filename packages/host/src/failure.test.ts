import { describe, expect, it } from "vitest"
import type { Event, TurnId } from "@switchback/protocol"
import { create, setup } from "./host-fixture.js"

/**
 * 一轮失败了，用户得看得见为什么。
 *
 * 起因是 mac2 上一条「坏掉」的会话：连发两条消息、一个字都没回来。翻日志才知道
 * 五轮全部 `turn.completed{status:"failed", error:"401 k3-256k supports only
 * 256K context."}`——上下文超了模型的窗口，每轮三秒就失败。而 `status` 和 `error`
 * 当时**没有任何读者**：归约器只清 `turns`/`tasks`，渲染层一个字都不读。
 * 于是界面上是一片空白，人只能以为会话坏了，而它其实换个模型就能继续。
 */
describe("失败的轮次要说出为什么", () => {
  function errors(events: readonly Event[]): string[] {
    return events
      .filter((e) => e.type === "item.started" && e.item.kind === "error")
      .map((e) => (e.type === "item.started" && e.item.kind === "error" ? e.item.message : ""))
  }

  async function running(): Promise<{ events: Event[]; session: ReturnType<typeof setup>["session"]; turnId: TurnId }> {
    const { host, events, session } = setup()
    await host.dispatch(create)
    const id = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    await host.dispatch({ type: "thread.prompt", threadId: id, text: "开工" })
    return { events, session, turnId: (session().prompts[0]?.turnId ?? "") as TurnId }
  }

  it("**引擎说了为什么，就摆进转录区**——不摆的话界面上是一片空白，人只会以为会话坏了", async () => {
    const { events, session, turnId } = await running()
    session().emit({ type: "turn.completed", at: 9, turnId, status: "failed", error: "401 k3-256k supports only 256K context." })
    expect(errors(events)).toEqual(["401 k3-256k supports only 256K context."])
  })

  it("**排在 turn.completed 之前**——排后面就掉进下一轮的开头了", async () => {
    const { events, session, turnId } = await running()
    session().emit({ type: "turn.completed", at: 9, turnId, status: "failed", error: "炸了" })
    const err = events.findIndex((e) => e.type === "item.started" && e.item.kind === "error")
    const done = events.findIndex((e) => e.type === "turn.completed")
    expect(err).toBeGreaterThan(-1)
    expect(err).toBeLessThan(done)
  })

  it("驱动自己已经说过同一句就不重复摆——同一件事说两次比不说更让人怀疑", async () => {
    const { events, session, turnId } = await running()
    session().emit({
      type: "item.started",
      at: 8,
      item: { id: "e1", turnId, at: 8, kind: "error", message: "炸了", fatal: true },
    })
    session().emit({ type: "turn.completed", at: 9, turnId, status: "failed", error: "炸了" })
    expect(errors(events)).toEqual(["炸了"])
  })

  it("驱动说的是另一句，两句都留——它们是两件事", async () => {
    const { events, session, turnId } = await running()
    session().emit({
      type: "item.started",
      at: 8,
      item: { id: "e1", turnId, at: 8, kind: "error", message: "重连中 1/5", fatal: false },
    })
    session().emit({ type: "turn.completed", at: 9, turnId, status: "failed", error: "重连五次都没成" })
    expect(errors(events)).toEqual(["重连中 1/5", "重连五次都没成"])
  })

  it("重试提示和最终失败是同一句时，失败卡照样要有——重试条不算「说过了」", async () => {
    const { events, session, turnId } = await running()
    session().emit({
      type: "item.started",
      at: 8,
      item: { id: "kimi-retry-1", turnId, at: 8, kind: "error", message: "Connection error.", fatal: false },
    })
    session().emit({ type: "turn.completed", at: 9, turnId, status: "failed", error: "Connection error." })
    const fatal = events.filter((e) => e.type === "item.started" && e.item.kind === "error" && e.item.fatal)
    expect(fatal).toHaveLength(1)
  })

  it("**中断不算失败**——那是用户自己按的停止，不需要一条报错", async () => {
    const { events, session, turnId } = await running()
    session().emit({ type: "turn.completed", at: 9, turnId, status: "interrupted" })
    expect(errors(events)).toEqual([])
  })

  it("跑成了当然不留报错", async () => {
    const { events, session, turnId } = await running()
    session().emit({ type: "turn.completed", at: 9, turnId, status: "completed" })
    expect(errors(events)).toEqual([])
  })
})
