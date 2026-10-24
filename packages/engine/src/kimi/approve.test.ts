import { describe, expect, it } from "vitest"
import type { Locale } from "@switchback/i18n"
import { approvalSummary } from "./approve.js"
import type { KimiApproval } from "./wire.js"

const approval = (patch: Partial<KimiApproval>): KimiApproval => ({
  approval_id: "a1",
  session_id: "s1",
  tool_call_id: "c1",
  tool_name: "Shell",
  action: "",
  tool_input_display: undefined,
  ...patch,
})

/** Kimi 给了 action 就照它说；没给才由 Switchback 按展示类型拼一句，拼的这句跟着界面语言。 */
describe("审批卡上那句「批准的是什么」", () => {
  const cases: readonly { patch: Partial<KimiApproval>; locale: Locale; want: string }[] = [
    { patch: { action: "Run `ls`" }, locale: "zh-CN", want: "Run `ls`" },
    { patch: { tool_input_display: { kind: "command", command: "ls -la" } }, locale: "zh-CN", want: "执行 ls -la" },
    { patch: { tool_input_display: { kind: "command", command: "ls -la" } }, locale: "en", want: "Run ls -la" },
    { patch: { tool_input_display: { kind: "diff", path: "/w/a.ts", before: "", after: "x" } }, locale: "en", want: "Edit /w/a.ts" },
    { patch: { tool_input_display: { kind: "url_fetch", url: "https://example.com" } }, locale: "en", want: "Access https://example.com" },
    { patch: {}, locale: "zh-CN", want: "执行 Shell（详情未送达）" },
    { patch: {}, locale: "en", want: "Run Shell (details not provided)" },
  ]
  for (const one of cases) {
    it(`${one.locale} → ${one.want}`, () => expect(approvalSummary(approval(one.patch), one.locale)).toBe(one.want))
  }
})
