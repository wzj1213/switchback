/**
 * 出图用的会话样本。
 *
 * ## 为什么不用真机上那些会话
 *
 * 界面改动要靠**前后对照**判断（字号、间距、密度这些，读代码看不出来），
 * 而对照的前提是两张图除了改动之外**别的一模一样**。拿真机记录出图的话，
 * 每次跑内容都不同，两张图之间的差别里混着「内容变了」这一项，
 * 那就什么都比不出来了。
 *
 * ## 这份样本要覆盖什么
 *
 * 一屏里同时出现**每一类 item**：提问、思考、shell、改文件、计划、回答（带 markdown）。
 * 它们在同一屏里的相对轻重，正是这套界面最该被看的东西——
 * 单独看任何一类都看不出「所有行长得一样」这个毛病。
 */

const ENGINE = "claude"

/** 一条事件一行，就是 journal 的格式。 */
const line = (event) => JSON.stringify(event)

function threadOf(id, title, cwd, at) {
  return {
    id,
    title,
    cwd,
    engine: ENGINE,
    trust: "auto-edit",
    status: "idle",
    createdAt: at,
    updatedAt: at,
    engineHistory: [ENGINE],
    model: "claude-opus-5",
    effort: "high",
    capabilities: {
      compact: false, attachments: true, steer: true, fork: true, rewind: true,
      modeReadback: false, sideQuestion: true, activity: true,
    },
  }
}

/** 主会话：一屏里把每一类 item 都摆出来。 */
export function mainThread(id, cwd, at, externalPath) {
  const turn = `${id}-t1`
  const out = [
    line({ type: "thread.started", at, thread: threadOf(id, "把订阅那段胶水抽成纯函数", cwd, at) }),
    line({
      type: "turn.started",
      at,
      turn: { id: turn, threadId: id, engine: ENGINE, status: "running", startedAt: at },
    }),
  ]
  let n = 0
  const push = (item) => {
    out.push(line({ type: "item.started", at, item: { ...item, id: `${id}-i${++n}`, turnId: turn, at } }))
  }
  fill(push, cwd, externalPath)
  fillActivity(out, { threadId: id, turnId: turn, cwd, at })
  out.push(line({ type: "turn.completed", at, turnId: turn, status: "completed" }))
  out.push(
    line({
      type: "usage.updated",
      at,
      threadId: id,
      engine: ENGINE,
      usage: { contextUsed: 369_000, contextWindow: 1_049_000, totalTokens: 50_826_000, cacheRead: 50_115_000 },
    }),
  )
  return `${out.join("\n")}\n`
}

/** 后台工作台样本：生命周期、真实 shell、子 agent 正文与可预览 HTML 同时覆盖。 */
function fillActivity(out, frame) {
  const { threadId, turnId, cwd, at } = frame
  const lane = "lane-research"
  out.push(line({
    type: "lane.updated", at, threadId,
    lane: {
      id: lane, threadId, kind: "activity", title: "并行检查侧栏与 HTML 预览",
      status: "running", at,
      command: "pnpm check:css && pnpm typecheck --pretty false",
      summary: "样式守卫通过：1033 个类有规则\nTypeScript：0 errors",
      progress: {
        nodes: [
          { id: "agent-a", label: "检查交互", state: "done", detail: "拖动与点击" },
          { id: "agent-b", label: "验证预览", state: "running", detail: "渲染 HTML" },
        ],
        budget: { used: 18_420 },
      },
    },
  }))
  const emit = (id, item) => out.push(line({
    type: "item.started", at,
    item: { ...item, id, turnId, at, lane: { id: lane } },
  }))
  emit("side-note", {
    kind: "agent_message", complete: true,
    text: "我在后台复核文件预览入口，并保留当前 shell 的实时输出。",
  })
  emit("side-shell", {
    kind: "tool_call", tool: "Bash", status: "running",
    detail: {
      kind: "shell", cwd, command: "pnpm check:css && pnpm typecheck",
      output: "样式守卫通过\n正在检查 TypeScript…",
    },
  })
  emit("side-html", {
    kind: "tool_call", tool: "Read", status: "ok",
    detail: { kind: "file_read", path: "docs/旁路侧栏-原型.html" },
  })
}

function fileRead(path, status) {
  return {
    kind: "tool_call",
    tool: "Read",
    status,
    detail: { kind: "file_read", path },
  }
}

/**
 * 一屏里该出现的那几类。**顺序就是真实会话的顺序**：
 * 问 → 想 → 读 → 跑 → 计划 → 改 → 答。
 */
function fill(push, cwd, externalPath) {
  push({
    kind: "user_message",
    text: "useFlow 里那几行——一批一次、一个字节都没有就别记、时间戳用收到的时刻——现在只能靠肉眼保证。照仓库里 usePetMood 的老规矩抽出来测一下。",
  })
  push({
    kind: "reasoning",
    complete: true,
    text: "先看 useFlow 现在的形状：它订阅 bridge，把每一批 sealed 事件里属于当前会话的字节记进滑窗。要抽的是「哪些字节算数」和「怎么记」这两件事。",
  })
  push({
    kind: "tool_call", tool: "Read", status: "ok",
    detail: { kind: "file_read", path: "apps/desktop/src/renderer/useFlow.ts" },
  })
  push({
    kind: "tool_call",
    tool: "Bash",
    status: "ok",
    detail: {
      kind: "shell",
      command: "grep -rn \"item.delta\" apps/desktop/src/renderer | head",
      cwd,
      exitCode: 0,
      output:
        "apps/desktop/src/renderer/flow-scope.ts:73:  if (event.type !== \"item.delta\") return 0\n" +
        "apps/desktop/src/renderer/throughput.ts:10: * - `item.delta` 是逐帧的：一次事件到一批字。",
    },
  })
  push({
    kind: "plan",
    steps: [
      { text: "把「算不算、算多少」抽成 flow-scope", status: "done" },
      { text: "滑窗单独成 throughput，表驱动测", status: "in_progress" },
      { text: "useFlow 只剩订阅", status: "pending" },
    ],
  })
  push({
    kind: "tool_call",
    tool: "Edit",
    status: "ok",
    detail: {
      kind: "file_edit",
      path: "apps/desktop/src/renderer/flow-scope.ts",
      files: [{ path: "apps/desktop/src/renderer/flow-scope.ts", kind: "added", added: 116, removed: 0 }],
      added: 116,
      removed: 0,
    },
  })
  if (externalPath !== undefined) {
    push({
      kind: "tool_call",
      tool: "Read",
      status: "ok",
      detail: { kind: "file_read", path: externalPath },
    })
  }
  push(fileRead("missing-output.txt", "ok"))
  push(fileRead("/tmp/failed-secret.txt", "failed"))
  push(answerOf())
}

/**
 * 那条回答。**单拎出来不只是行数**：这一段是整屏唯一「该被读完」的东西，
 * 而它要同时压得住标题、列表、行内代码、代码块四种排版——
 * 一屏里少覆盖一种，那一种的毛病就永远不会在出图里现形。
 */
function answerOf() {
  return {
    kind: "agent_message",
    complete: true,
    text:
      "抽出来了，`useFlow` 现在只剩订阅本身。\n\n" +
      "## 为什么分成两个文件\n\n" +
      "`flow-scope` 回答「这条 delta 算不算这条会话的」，`throughput` 回答「这一秒有多快」。" +
      "两件事的失效方式完全不同：前者错了会替**另一条会话**开火，后者错了只是数字抖。\n\n" +
      "- **身份走两跳补回来**：`turn.started` 带 `threadId`，`item.started` 带 `turnId`\n" +
      "- **一批只记一笔**——主进程已经合过帧，逐条记会把一次往返撑成假峰值\n" +
      "- 字节数手算而不是 `TextEncoder`：这条路每秒要走几十次\n\n" +
      "```ts\nexport function drain(scope: Scope, meter: Meter, sealed: readonly Sealed[], now: number): void {\n" +
      "  let bytes = 0\n  for (const one of sealed) bytes += absorb(scope, one.event)\n" +
      "  if (bytes > 0) mark(meter, now, bytes)\n}\n```\n\n" +
      "新测里有一条钉的就是「一批只记一笔」：用「合成一笔」和「拆成八笔」在同一个窗口里算出同一个流速。",
  }
}

/** 侧栏里的陪衬：只要标题和时间，不需要内容。 */
export function stubThread(id, title, cwd, at) {
  return `${line({ type: "thread.started", at, thread: threadOf(id, title, cwd, at) })}\n`
}
