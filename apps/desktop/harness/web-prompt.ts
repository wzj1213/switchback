import type { Command, Event } from "@omni/protocol"

type Prompt = Extract<Command, { type: "thread.prompt" }>

/**
 * 验收台不跑引擎，但仍要把远程 prompt 回显到**原会话**。
 *
 * 临时建一轮再立刻收口，既给 store 一条可靠的 turn → thread 归属边，
 * 又不冒充一份并不存在的模型回答。
 */
export function promptEcho(command: Prompt, engine: string, at: number): readonly Event[] {
  const turnId = `harness-prompt-${String(at)}`
  return [
    {
      type: "turn.started",
      at,
      turn: { id: turnId, threadId: command.threadId, engine, status: "running", startedAt: at },
    },
    {
      type: "item.started",
      at,
      item: { id: `harness-item-${String(at)}`, turnId, kind: "user_message", at, text: command.text },
    },
    { type: "turn.completed", at, turnId, status: "completed" },
  ]
}
