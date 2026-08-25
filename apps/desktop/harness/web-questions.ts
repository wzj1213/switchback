import type { PendingQuestion } from "@omni/protocol"

export const WEB_QUESTIONS: readonly PendingQuestion[] = [
  {
    id: "q-grok-plan",
    questions: [{
      id: "grok-exit-plan:plan",
      header: "Grok 计划审批",
      question: "如何处理这份计划？",
      body: "# Audit plan\n\n1. Inspect README.md\n2. Run the focused tests\n3. Report the evidence",
      options: [
        { id: "approved", label: "批准并执行", description: "退出计划模式并开始执行" },
        { id: "cancelled", label: "要求修改", description: "把补充说明反馈给 Grok，继续规划" },
        { id: "abandoned", label: "放弃计划", description: "退出计划模式但不执行" },
      ],
      allowNote: true,
      noteLabel: "修改意见（可选）",
      noteDescription: "选择“要求修改”时，可在这里说明要改什么",
    }],
  },
  {
    id: "q-refusal-fallback",
    expiresAt: Date.now() + 86_400_000,
    questions: [{
      id: "claude-refusal-fallback",
      header: "Claude · 会话已暂停",
      question: "这次请求被原模型拒绝，接下来怎么做？",
      body: "Claude 建议改写请求，或切换到备用模型继续。",
      options: [
        { id: "retry_fallback", label: "切换到 claude-sonnet-4-6", description: "用备用模型重试当前请求" },
        {
          id: "edit_prompt", label: "修改后继续用 claude-opus-4-1",
          description: "结束当前轮；在输入框修改后重新发送",
        },
      ],
    }],
  },
  {
    id: "q-harness",
    expiresAt: Date.now() + 86_400_000,
    questions: [
      {
        id: "path",
        header: "实现路径",
        question: "这次先走哪条方案？",
        body: "答案会通过引擎自己的结构化接口返回，不会变成一条新的普通消息。",
        external: { url: "https://accounts.example.com/connect?flow=omni" },
        options: [
          {
            id: "steady", label: "稳妥修复", description: "只改已经确认的断点，风险更低。",
            preview: "packages/engine/src/acp/\n  grok-interaction.ts\n  interaction.ts",
          },
          { id: "deep", label: "顺手重构", description: "连附近边界一起整理，改动更大。" },
        ],
        allowNote: true,
        noteLabel: "补充说明（可选）",
        noteDescription: "例如：先保行为，再整理边界",
        optional: true,
      },
      {
        id: "checks",
        header: "验收范围",
        question: "这轮要覆盖哪些检查？",
        options: [
          { id: "desktop", label: "桌面端" },
          { id: "phone", label: "手机端" },
        ],
        multiSelect: true,
        allowOther: true,
        otherLabel: "再补一项",
        otherDescription: "例如：弱网重连",
      },
      {
        id: "secret",
        header: "敏感补充",
        question: "有只适合这次使用的临时信息吗？",
        options: [],
        allowNote: true,
        noteLabel: "回答",
        noteDescription: "输入内容会遮挡显示",
        secret: true,
        optional: true,
      },
    ],
  },
]
