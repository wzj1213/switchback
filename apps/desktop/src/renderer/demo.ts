import type { Item, Thread } from "@omni/protocol"

/**
 * 静态样例数据。
 *
 * 它存在的唯一目的是**在接引擎之前验证 `@omni/protocol` 的模型足以驱动 UI**：
 * 七种 item 全部在这里出现，渲染层能把它们画出来，模型就算过关。
 * 接上 `@omni/host` 之后整个文件删掉。
 */

const TURN = "turn-1"

export const DEMO_THREADS: readonly Thread[] = [
  {
    id: "t-1",
    title: "重排审批判定管线",
    cwd: "/Users/dev/work/omni",
    engine: "codex",
    trust: "auto-edit",
    status: "waiting_approval",
    createdAt: 0,
    updatedAt: 0,
    engineHistory: ["claude", "codex"],
  },
  {
    id: "t-2",
    title: "把 chat.go 拆成五个包",
    cwd: "/Users/dev/work/omni",
    engine: "claude",
    trust: "auto-edit",
    status: "running",
    createdAt: 0,
    updatedAt: 0,
    engineHistory: ["claude"],
  },
  {
    id: "t-3",
    title: "红线表补 exec 写越界用例",
    cwd: "/Users/dev/work/omni",
    engine: "acp:zcode",
    trust: "read-only",
    status: "idle",
    createdAt: 0,
    updatedAt: 0,
    engineHistory: ["acp:zcode"],
  },
]

export const DEMO_ITEMS: readonly Item[] = [
  {
    id: "i-1",
    turnId: TURN,
    kind: "user_message",
    at: 0,
    text: "把 engine-settings-write 排到 write-outside-worksite 前面，然后补一条回归。",
  },
  {
    id: "i-2",
    turnId: TURN,
    kind: "reasoning",
    at: 1,
    complete: true,
    text: "两条红线都会命中 ~/.claude 下的写入。更泛的那条排在前面，用户看到的理由就会是「不在工作区内」，丢掉了「这会改掉引擎自己的权限配置」这个关键信息。",
  },
  {
    id: "i-3",
    turnId: TURN,
    kind: "plan",
    at: 2,
    steps: [
      { text: "调整 REDLINES 顺序", status: "done" },
      { text: "补一条顺序回归用例", status: "in_progress" },
      { text: "跑 pnpm check", status: "pending" },
    ],
  },
  {
    id: "i-4",
    turnId: TURN,
    kind: "tool_call",
    at: 3,
    tool: "apply_patch",
    status: "ok",
    detail: {
      kind: "file_edit",
      path: "packages/approval/src/redline.ts",
      added: 22,
      removed: 20,
    },
  },
  {
    id: "i-5",
    turnId: TURN,
    kind: "tool_call",
    at: 4,
    tool: "shell",
    status: "ok",
    detail: {
      kind: "shell",
      command: "pnpm test",
      exitCode: 0,
      output: " Test Files  1 passed (1)\n      Tests  31 passed (31)",
    },
  },
  {
    id: "i-6",
    turnId: TURN,
    kind: "tool_call",
    at: 5,
    tool: "shell",
    status: "pending",
    detail: { kind: "shell", command: "git push origin refactor/redline-order" },
  },
  {
    id: "i-7",
    turnId: TURN,
    kind: "approval",
    at: 6,
    toolCallId: "i-6",
    tool: "shell",
    summary: "git push origin refactor/redline-order",
    status: "pending",
    reason: "推送到远端是对外可见的不可逆动作，必须人工确认",
  },
  {
    id: "i-8",
    turnId: TURN,
    kind: "agent_message",
    at: 7,
    complete: false,
    text: "顺序已调整，31 条用例全绿。推送前需要你确认",
  },
]
