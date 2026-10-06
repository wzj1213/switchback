import type { PlanStep } from "@switchback/protocol"
import type { KimiToolDisplay } from "./wire.js"

const STATUS: Readonly<Record<string, PlanStep["status"]>> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "done",
  done: "done",
  cancelled: "dropped",
  dropped: "dropped",
}

/** Kimi Web 把整份待办放在公开的 todo_list display 中。undefined 表示这不是计划工具。 */
export function planSteps(display: KimiToolDisplay | undefined): readonly PlanStep[] | undefined {
  if (display?.kind !== "todo_list") return undefined
  return display.items.map((item) => ({ text: item.title, status: STATUS[item.status] ?? "pending" }))
}
