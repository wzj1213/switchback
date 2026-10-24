import { count, defineMessages } from "@switchback/i18n"

/**
 * 转写的标题与记法。这份文件是给接手的那家引擎读的，跟着交接那一刻的界面语言；
 * 对话正文、命令、输出原样照抄，不翻译。
 */
export const TRANSCRIPT = defineMessages(
  {
    run: (command: string) => `执行 \`${command}\``,
    edit: (path: string, added: number, removed: number) => `编辑 ${path}（+${String(added)} −${String(removed)}）`,
    read: (path: string, range: readonly [number, number] | undefined) =>
      `读取 ${path}${range === undefined ? "" : `（第 ${String(range[0])}–${String(range[1])} 行）`}`,
    fetch: (url: string) => `抓取 ${url}`,
    tool: (tool: string, what: string, status: string, nativeId: string | undefined) =>
      `#### 工具 ${tool}：${what} — ${status}${nativeId === undefined ? "" : `〔${nativeId}〕`}`,
    exitCode: (code: number) => `退出码 ${String(code)}`,
    file: (path: string, kind: string) => `${path}（${kind}）`,
    input: "输入",
    output: "输出",
    error: (text: string) => `错误：${text}`,
    plan: "#### 计划",
    lane: (id: string) => `（旁路 ${id}）`,
    who: { user: "用户", handoff: "交接说明", auto: "自动触发" },
    attachments: (list: readonly string[]) => `附件：${list.join("、")}`,
    errorHead: (fatal: boolean) => `#### 报错${fatal ? "（致命）" : ""}`,
    approval: (tool: string, status: string) => `#### 审批 ${tool} — ${status}`,
    reason: (text: string) => `理由：${text}`,
    answer: (lane: string, complete: boolean) => `#### 回答${lane}${complete ? "" : "（未完成）"}`,
    thinking: (lane: string) => `#### 思考${lane}`,
    notice: (level: string) => `#### 提示（${level}）`,
    title: (title: string) => `# 会话转写：${title}`,
    id: (id: string) => `- 会话 id：${id}`,
    cwd: (cwd: string) => `- 工作区：${cwd}`,
    at: (iso: string) => `- 生成时间：${iso}（Switchback 从会话记录整理）`,
    turns: (n: number, route: string) => `- 共 ${String(n)} 轮；引擎：${route}`,
    legend: "- 记法：每轮标题写着第几轮、开始时间（UTC）、哪家引擎在跑；工具调用行尾〔…〕是引擎自己报的调用 id，用来到它的原始记录里对位。",
    turn: (n: number, when: string) => `## 第 ${String(n)} 轮${when}`,
  },
  {
    run: (command) => `Run \`${command}\``,
    edit: (path, added, removed) => `Edit ${path} (+${String(added)} −${String(removed)})`,
    read: (path, range) => `Read ${path}${range === undefined ? "" : ` (lines ${String(range[0])}–${String(range[1])})`}`,
    fetch: (url) => `Fetch ${url}`,
    tool: (tool, what, status, nativeId) => `#### Tool ${tool}: ${what} — ${status}${nativeId === undefined ? "" : ` [${nativeId}]`}`,
    exitCode: (code) => `Exit code ${String(code)}`,
    file: (path, kind) => `${path} (${kind})`,
    input: "Input",
    output: "Output",
    error: (text) => `Error: ${text}`,
    plan: "#### Plan",
    lane: (id) => ` (side lane ${id})`,
    who: { user: "User", handoff: "Handoff note", auto: "Automatic trigger" },
    attachments: (list) => `Attachments: ${list.join(", ")}`,
    errorHead: (fatal) => `#### Error${fatal ? " (fatal)" : ""}`,
    approval: (tool, status) => `#### Approval ${tool} — ${status}`,
    reason: (text) => `Reason: ${text}`,
    answer: (lane, complete) => `#### Answer${lane}${complete ? "" : " (incomplete)"}`,
    thinking: (lane) => `#### Thinking${lane}`,
    notice: (level) => `#### Notice (${level})`,
    title: (title) => `# Thread transcript: ${title}`,
    id: (id) => `- Thread id: ${id}`,
    cwd: (cwd) => `- Workspace: ${cwd}`,
    at: (iso) => `- Generated: ${iso} (compiled by Switchback from the thread's records)`,
    turns: (n, route) => `- ${count(n, "turn")}; engines: ${route}`,
    legend:
      "- Notation: each turn heading gives the turn number, its start time (UTC), and which engine ran it; " +
      "the [...] at the end of a tool line is the call id the engine itself reported, for finding it in the engine's raw record.",
    turn: (n, when) => `## Turn ${String(n)}${when}`,
  },
)
