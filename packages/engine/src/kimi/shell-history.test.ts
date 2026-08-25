import { describe, expect, it } from "vitest"
import { kimiShellHistoryItem } from "./shell-history.js"
import type { KimiTranscriptTurn } from "./wire.js"

function turn(phase: "input" | "output", prompt: string, isError = false): KimiTranscriptTurn {
  return {
    kind: "turn",
    turnId: phase,
    state: "completed",
    origin: {
      kind: "user",
      payload: { kind: "shell_command", phase, ...(isError ? { isError } : {}) },
    },
    prompt,
    steps: [],
  }
}

describe("Kimi shell 历史", () => {
  it("把公开 XML 还原成原生可见的命令与输出", () => {
    const cases = [
      {
        raw: turn("input", "<bash-input>\nprintf &quot;&lt;ok&gt;&amp;&quot;\n</bash-input>"),
        want: {
          id: "history-input-prompt",
          kind: "user_message",
          text: '$ printf "<ok>&"',
          origin: { kind: "shell" },
        },
      },
      {
        raw: turn(
          "output",
          "<bash-stdout>  done\u001b[31m</bash-stdout><bash-stderr>warn &amp; note</bash-stderr>",
          true,
        ),
        want: {
          id: "history-output-shell-output",
          kind: "notice",
          message: "  done\nwarn & note",
          level: "warning",
        },
      },
    ] as const

    for (const row of cases) {
      expect(kimiShellHistoryItem(row.raw, `history-${row.raw.turnId}`, 7)).toMatchObject(row.want)
    }
  })

  it("空输出沿用 Kimi 的原生占位文案", () => {
    const item = kimiShellHistoryItem(
      turn("output", "<bash-stdout></bash-stdout><bash-stderr></bash-stderr>"),
      "history-empty",
      7,
    )

    expect(item).toMatchObject({ kind: "notice", message: "(no output)", level: "info" })
  })
})
