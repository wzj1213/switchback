import type { Item } from "@switchback/protocol"

export const WEB_NATIVE_ITEMS: readonly Item[] = [
  {
    id: "i-cron",
    turnId: "u-1",
    kind: "user_message",
    at: 1_760_000_000_000.5,
    text: "检查部署与错误率，发现异常就说明影响范围。",
    origin: {
      kind: "scheduled",
      taskId: "cron-harness",
      schedule: "7 * * * *",
      recurring: true,
      coalescedCount: 3,
      stale: false,
    },
  },
  {
    id: "i-shell-command",
    turnId: "u-1",
    kind: "user_message",
    at: 1_760_000_000_001,
    text: "$ printf 'release ready\\n'",
    origin: { kind: "shell" },
  },
  {
    id: "i-shell-output",
    turnId: "u-1",
    kind: "notice",
    at: 1_760_000_000_002,
    message: "release ready",
    level: "info",
  },
  {
    id: "i-goal-continuation",
    turnId: "u-1",
    kind: "user_message",
    at: 1_760_000_000_003,
    text: "",
    origin: { kind: "goal_continuation" },
  },
]
