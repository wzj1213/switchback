import type { Item } from "@omni/protocol"

const at = 1_760_000_000_000

/** 后台终端的等待与完成两态；浏览器验收台用它检查手机端标题、展开内容和溢出。 */
export const WEB_TERMINALS: readonly Item[] = [
  {
    id: "i-terminal-wait",
    turnId: "u-1",
    kind: "tool_call",
    at: at + 7,
    tool: "shell",
    status: "running",
    detail: {
      kind: "shell",
      command: "pnpm test",
      output: "Test Files 174 passed\n",
      terminal: { waiting: true, inputs: [] },
    },
  },
  {
    id: "i-terminal-done",
    turnId: "u-1",
    kind: "tool_call",
    at: at + 8,
    tool: "shell",
    status: "ok",
    detail: {
      kind: "shell",
      command: "sh -c 'read line; echo GOT:$line'",
      output: "GOT:OMNI_TERMINAL_INPUT\n",
      terminal: { waiting: false, inputs: ["OMNI_TERMINAL_INPUT\n"] },
    },
  },
]
