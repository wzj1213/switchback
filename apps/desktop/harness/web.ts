/**
 * 浏览器端的开发/验收台。**不起 Electron、不起任何引擎。**
 *
 * 它把真的远程服务端（`main/remote/server.ts`）接到一份合成的会话数据上，
 * 于是浏览器端可以脱离整个桌面应用单独跑、单独看、单独截图。
 *
 * 用法：
 *
 * ```sh
 * pnpm build:web                       # 先出前端产物
 * pnpm harness:web                    # 等价于下面这条
 * node --import jiti/register apps/desktop/harness/web.ts
 * ```
 *
 * 打印出来的令牌可以直接塞进 `localStorage.switchback.token`，跳过配对屏。
 * 加 `--live` 会每两秒往会话里追加一段流式文本，用来看滚动与贴底。
 */
import { createHash } from "node:crypto"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Command, Event, Item, Lane, Thread } from "@switchback/protocol"
import { createLedger } from "@switchback/wire"
import { createTokenStore, type Device } from "../src/main/remote/tokens.js"
import { startRemote } from "../src/main/remote/server.js"
import type { Sink } from "../src/main/sink.js"
import { WEB_NOTICES } from "./web-notices.js"
import { WEB_NATIVE_ITEMS } from "./web-native-items.js"
import { WEB_TERMINALS } from "./web-terminals.js"
import { WEB_QUESTIONS } from "./web-questions.js"
import { promptEcho } from "./web-prompt.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
/** 端口与可信 Host 都能用环境变量覆盖：隧道那头的域名要填进来才过得了 Host 闸。 */
const PORT = Number(process.env["SWITCHBACK_HARNESS_PORT"] ?? 17801)
const TRUSTED = (process.env["SWITCHBACK_HARNESS_HOSTS"] ?? "").split(/\s+/).filter((s) => s !== "")
/** 固定令牌，**只在这个 harness 里**。真实的令牌是 32 字节随机数。 */
const DEV_TOKEN = "harness-dev-token-not-a-secret"

const at = 1_760_000_000_000
/** 这次 harness 运行的代号。真宿主用 randomUUID，这里固定一个便于重跑。 */
const EPOCH = "harness"

const NATIVE_NOTIFICATION: Event = {
  type: "engine.notification", at, threadId: "t-2", engine: "claude",
  key: "fast-mode-overage-rejected", message: "Fast mode is unavailable for this account.",
  priority: "immediate", color: "error", timeoutMs: 5000,
}

const thread = (id: string, title: string, status: Thread["status"]): Thread => ({
  id,
  title,
  cwd: "/Users/you/work/switchback",
  engine: id === "t-2" ? "claude" : "codex",
  trust: "auto-edit",
  status,
  createdAt: at,
  updatedAt: at + (id === "t-1" ? 300 : 100),
  engineHistory: ["codex"],
  ...(id === "t-1" ? {
    pendingQuestions: WEB_QUESTIONS,
    goal: {
      objective: "逐项完成项目自检、补齐所有已确认的原生能力，并在每一项通过生产验收后独立提交",
      status: "active",
      tokenBudget: 80_000,
      tokensUsed: 24_600,
      timeUsedSeconds: 3_661,
    },
  } : {}),
  ...(id === "t-3" ? {
    asides: [{ at: at + 1, question: "这条旧侧问还能看到吗？", answer: "可以，旧日志继续兼容。" }],
  } : {}),
})

const WEB_LANES: readonly Lane[] = [
  { id: "aside-done", threadId: "t-1", kind: "aside", status: "done", at: at + 20,
    title: "这个改动会影响手机端吗？", summary: "会，手机端现在也会按原位置显示侧问。" },
  { id: "aside-running", threadId: "t-1", kind: "aside", status: "running", at: at + 21,
    title: "当前还在核对哪一步？" },
  {
    id: "activity-running", threadId: "t-1", kind: "activity", status: "running", at: at + 22, title: "后台核对两端",
    progress: { nodes: [
      { id: "desktop", label: "桌面端", state: "done", detail: "生产构建通过" },
      { id: "phone", label: "手机端", state: "running", detail: "检查 390px 窄屏" },
      { id: "docs", label: "更新记录", state: "pending" },
    ] },
  },
]
const items: readonly Item[] = [
  { id: "i-1", turnId: "u-1", kind: "user_message", at, text: "把审批那一屏在窄屏上过一遍" },
  ...WEB_NATIVE_ITEMS,
  {
    id: "i-2",
    turnId: "u-1",
    kind: "reasoning",
    at: at + 1,
    text: "先看看现在的布局……命令原文那一行在 390 点宽下会不会被截断。",
    complete: true,
  },
  {
    id: "i-3",
    turnId: "u-1",
    kind: "agent_message",
    at: at + 2,
    text: "看了一遍，有三处要改：\n\n1. **命令原文**要等宽、可横滚\n2. 两颗按钮不小于 44×44\n3. 底部要留 `safe-area`\n\n```ts\nconst MIN_HIT = 44\n```\n\n| 项 | 现状 | 改成 |\n| --- | --- | --- |\n| 字号 | 13px | 13px 等宽 |\n| 换行 | 折行 | 不折，横滚 |",
    complete: true,
  },
  {
    id: "i-4",
    turnId: "u-1",
    kind: "tool_call",
    at: at + 3,
    tool: "Bash",
    status: "ok",
    detail: { kind: "shell", command: "rg -n 'approval__cmd' apps/web/src", output: "styles.css:640:.approval__cmd {\nstyles.css:645:.approval__cmd--block {" },
  },
  {
    id: "i-5",
    turnId: "u-1",
    kind: "tool_call",
    at: at + 4,
    tool: "Edit",
    status: "ok",
    detail: {
      kind: "file_edit",
      path: "apps/web/src/styles.css",
      added: 4,
      removed: 1,
      files: [{ path: "apps/web/src/styles.css", kind: "update", added: 4, removed: 1, diff: "@@ -640,7 +640,10 @@\n-  white-space: normal;\n+  white-space: pre;\n+  overflow-x: auto;" }],
    },
  },
  {
    id: "i-6",
    turnId: "u-1",
    kind: "approval",
    at: at + 5,
    toolCallId: "i-7",
    tool: "Bash",
    summary: "rm -rf /Users/you/work/switchback/apps/web/dist && pnpm --filter @switchback/web run build",
    status: "pending",
    reason: "这条命令里有 `rm -rf`，解析不出它最终会删到哪儿——按红线表必须问你一次。",
    rememberHint: "本会话内的构建命令",
  },
  {
    id: "i-plan",
    turnId: "u-1",
    kind: "plan",
    at: at + 6,
    explanation: "先把窄屏主路径跑通，再补交互态。",
    steps: [
      { text: "核对审批卡在窄屏上的信息层级", status: "done" },
      { text: "验证输入框上方的常驻计划进度", status: "in_progress" },
      { text: "检查断线与重新接入状态", status: "pending" },
    ],
  },
  ...WEB_TERMINALS,
  ...WEB_NOTICES,
]

/**
 * 一条**很长**的会话，用来验「先挂 80 条 + 显示更早的」那条路。
 *
 * 加进来是因为原来那三条都只有几条 item，那颗按钮根本不出现——
 * **验不了的东西等于没做**。条数取 200：比首屏那 80 多得明显，
 * 又不至于让 harness 自己慢下来。
 */
const LONG: readonly Item[] = Array.from({ length: 200 }, (_, i): Item =>
  i % 2 === 0
    ? { id: `long-${String(i)}`, turnId: "u-长", kind: "user_message", at: at + i, text: `第 ${String(i + 1)} 条：验长列表。` }
    : { id: `long-${String(i)}`, turnId: "u-长", kind: "agent_message", at: at + i, text: `第 ${String(i + 1)} 条：验长列表。`, complete: true },
)

const seed: readonly Event[] = [
  { type: "engines.available", at, engines: [{ id: "codex", label: "Codex", state: "ok" }] },
  { type: "thread.started", at, thread: thread("t-长", "一条很长的会话（200 条）", "idle") },
  { type: "turn.started", at, turn: { id: "u-长", threadId: "t-长", engine: "codex", status: "completed", startedAt: at } },
  ...LONG.map((item): Event => ({ type: "item.started", at: item.at, item })),
  { type: "thread.started", at, thread: thread("t-3", "更新日志的措辞", "idle") },
  { type: "thread.started", at, thread: thread("t-2", "ACP 换模型那条红条", "running") },
  { type: "turn.started", at, turn: { id: "u-2", threadId: "t-2", engine: "claude", status: "running", startedAt: at } },
  { type: "thinking.updated", at, threadId: "t-2", turnId: "u-2", estimatedTokens: 2840 },
  { type: "thread.started", at, thread: thread("t-1", "浏览器端的审批屏", "waiting_approval") },
  { type: "turn.started", at, turn: { id: "u-1", threadId: "t-1", engine: "codex", status: "running", startedAt: at } },
  ...items.map((item): Event => ({ type: "item.started", at: item.at, item })),
  ...WEB_LANES.map((lane): Event => ({ type: "lane.updated", at: lane.at, threadId: lane.threadId, lane })),
  { type: "usage.updated", at, threadId: "t-1", engine: "codex", usage: { contextUsed: 42_000, contextWindow: 200_000 } },
]

async function replayHarness(ledger: ReturnType<typeof createLedger>, sinks: Sink[], sink: Sink): Promise<void> {
  // t-长 与 t-1 的正文就在这份基线里；其余两条故意留给 watch → thread，
  // 同生产分级 replay 一样验到「按需补正文」与真正空会话的收口。
  sink.send({
    channel: "switchback:replay",
    replay: { events: seed, resumeAt: ledger.latest(), epoch: EPOCH, bodies: ["t-长", "t-1"] },
  })
  await Promise.resolve()
  // replay 收尾会清历史横幅；稍后作为真正的 live event 推，才能验到原生瞬时通知。
  setTimeout(() => {
    const sealed = ledger.seal([NATIVE_NOTIFICATION])
    for (const target of new Set([...sinks, sink])) target.send({ channel: "switchback:events", sealed })
  }, 250)
}

function main(): void {
  const ledger = createLedger(EPOCH)
  const sinks: Sink[] = []
  const device: Device = {
    id: "harness",
    name: "harness 上的浏览器",
    hash: createHash("sha256").update(DEV_TOKEN).digest("hex"),
    createdAt: at,
    lastSeenAt: at,
  }
  const tokens = createTokenStore({ load: () => [device], save: () => undefined, now: () => Date.now() })
  const pairing = tokens.startPairing()

  void startRemote({
    config: () => ({ port: PORT, trustedHosts: TRUSTED, maxTrust: "auto-edit" }),
    webRoot: join(ROOT, "apps/web/dist"),
    pushKey: () => "harness 不推送",
    tokens,
    ledger,
    sinks: {
      list: () => sinks,
      add: (sink) => {
        sinks.push(sink)
        return () => sinks.splice(sinks.indexOf(sink), 1)
      },
    },
    dispatch: (command: Command) => {
      console.log("← 命令", JSON.stringify(command))
      if (command.type === "approval.resolve") {
        const settled: Item = { ...(items[5] as Item & { kind: "approval" }), status: command.allow ? "allowed" : "denied" }
        broadcast(ledger, sinks, [{ type: "item.updated", at: Date.now(), item: settled }])
      }
      if (command.type === "thread.prompt") {
        const now = Date.now()
        const engine = command.threadId === "t-2" ? "claude" : "codex"
        broadcast(ledger, sinks, promptEcho(command, engine, now))
      }
      if (command.type === "question.resolve") {
        const settled = thread("t-1", "浏览器端的审批屏", "waiting_approval")
        delete settled.pendingQuestions
        broadcast(ledger, sinks, [{ type: "thread.updated", at: Date.now(), thread: settled }])
      }
    },
    replay: (sink) => replayHarness(ledger, sinks, sink),
    trustOf: (threadId) => (threadId === "t-1" || threadId === "t-2" || threadId === "t-3" ? "auto-edit" : undefined),
    history: async () => ({ events: [], trimmed: false }),
    log: (level, message) => {
      console.log(`[${level}] ${message}`)
    },
  }).then(() => {
    console.log(`\nswitchback web harness: http://127.0.0.1:${String(PORT)}`)
    console.log(`令牌：${DEV_TOKEN}`)
    console.log(`配对码：${pairing.code}`)
    console.log(`跳过配对：localStorage.setItem("switchback.token", ${JSON.stringify(DEV_TOKEN)})\n`)
    if (process.argv.includes("--live")) live(ledger, sinks)
  })
}

/** 每两秒追加一段流式文本，用来看贴底与滚动。 */
function live(ledger: ReturnType<typeof createLedger>, sinks: Sink[]): void {
  const state = { n: 0 }
  setInterval(() => {
    state.n += 1
    broadcast(ledger, sinks, [
      { type: "item.delta", at: Date.now(), itemId: "i-3", append: `\n\n第 ${String(state.n)} 段追加的内容。` },
    ])
  }, 2000)
}

function broadcast(ledger: ReturnType<typeof createLedger>, sinks: readonly Sink[], events: readonly Event[]): void {
  const sealed = ledger.seal(events)
  for (const sink of sinks) sink.send({ channel: "switchback:events", sealed })
}

main()
