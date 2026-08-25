import { describe, expect, it } from "vitest"
import type { Event, TurnId } from "@omni/protocol"
import { KimiActivations } from "./activation.js"

describe("Kimi 原生激活标记", () => {
  it("沿用原生文案并按 activationId 去掉 durable 重放", () => {
    const events: Event[] = []
    const turns: { current?: TurnId } = { current: "turn-1" }
    const activations = new KimiActivations({
      emit: (event) => events.push(event),
      turnId: () => turns.current,
    })
    const cases = [
      {
        type: "skill.activated",
        activationId: "skill-1",
        skillName: "review",
        skillPath: "/private/skill.md",
        trigger: "model-tool",
        message: "Activated skill: review",
      },
      {
        type: "plugin_command.activated",
        activationId: "plugin-1",
        pluginId: "release",
        commandName: "check",
        trigger: "user-slash",
        message: "/release:check",
      },
    ] as const

    for (const row of cases) {
      expect(activations.handle(row, 10)).toBe(true)
      expect(activations.handle(row, 11)).toBe(true)
    }
    expect(events).toMatchObject(
      cases.map((row) => ({
        type: "item.started",
        item: { id: `kimi-activation-${row.activationId}`, kind: "notice", message: row.message },
      })),
    )
    expect(JSON.stringify(events)).not.toContain("private/skill.md")
  })

  it("没有宿主轮次时只消费标记，不伪造轮次", () => {
    const events: Event[] = []
    const activations = new KimiActivations({
      emit: (event) => events.push(event),
      turnId: () => undefined,
    })

    expect(
      activations.handle(
        {
          type: "skill.activated",
          activationId: "external",
          skillName: "review",
          trigger: "user-slash",
        },
        10,
      ),
    ).toBe(true)
    expect(events).toEqual([])
  })
})
