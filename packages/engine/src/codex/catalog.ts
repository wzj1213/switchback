import type { EngineAccount, EngineThread, ModelOption, SlashCommand } from "@omni/protocol"
import type { WireSkill, WireSkillGroup } from "./wire.js"

/*
 * codex 报上来的东西 → omni 的中立形状。
 *
 * 从驱动里拆出来的边界是：**驱动只管发 RPC 和收通知，形状转换在这儿。**
 * 这样「codex 的技能长什么样」这件事只有这一个文件知道，
 * 而它恰恰是最常跟着对端版本变的部分。
 */

/**
 * `skills/list` 的结果铺平成斜杠命令。
 *
 * 返回是按 cwd 分组的（一个 app-server 可以同时服务多个工作区），这里全铺平——
 * 一个 omni 会话只对着一个工作区，分组信息对用户没有意义。
 * **停用的技能不给**：它在 codex 那边就不生效，列出来只会让人白点一次。
 */
export function skillsToCommands(raw: unknown): readonly SlashCommand[] {
  const groups = (raw as { data?: readonly WireSkillGroup[] } | undefined)?.data ?? []
  const seen = new Set<string>()
  const out: SlashCommand[] = []
  for (const group of groups) {
    for (const skill of group.skills ?? []) {
      if (skill.enabled === false || seen.has(skill.name)) continue
      seen.add(skill.name)
      out.push(toSlashCommand(skill))
    }
  }
  return out
}

/**
 * 一条技能 → 一条斜杠命令。
 *
 * 名字用 `name`（那是**真正要打进输入框的东西**），而说明优先用
 * `interface.shortDescription`——技能的 `description` 是写给模型看的触发条件，
 * 动辄两百字还带一串触发词，摆在选择列表里读不了。
 */
function toSlashCommand(skill: WireSkill): SlashCommand {
  const short = skill.interface?.shortDescription ?? undefined
  const display = skill.interface?.displayName ?? undefined
  return {
    name: skill.name,
    // **displayName 当名字用，不再塞进说明里。** codex 自己的面板左边一列
    // 就是它（「berth 收编」而不是 `/berth-adopt`），因为人扫那一列是在找**那件事**。
    // 上一版把它拼在说明最前面，结果是左边一列全是英文标识符、
    // 右边一列每条都以中文名开头——两列都读不痛快
    ...(display === undefined || display === skill.name ? {} : { label: display }),
    description: short ?? skill.description ?? "",
    source: "engine",
    ...(scopeOf(skill.scope) === undefined ? {} : { scope: scopeOf(skill.scope) }),
  }
}

/**
 * codex 的 `scope` → omni 的。实测取值是 `user` / `system`；
 * **不认的一律丢掉**而不是照抄成字符串——界面按枚举画标签，
 * 混进一个没见过的值只会画出个乱码似的角标。
 */
function scopeOf(raw: string | undefined): SlashCommand["scope"] {
  if (raw === "user" || raw === "project" || raw === "system") return raw
  return undefined
}

/* ── 模型清单 ─────────────────────────────────
 * 和技能一样是**形状转换**，所以住在这儿而不是驱动里：
 * 驱动只管发 RPC 和收通知，「codex 的模型长什么样」只该有一个文件知道。
 */

export interface WireModel {
  id?: string
  model?: string
  displayName?: string
  description?: string
  hidden?: boolean
  supportedReasoningEfforts?: readonly (string | { reasoningEffort?: string })[]
  defaultReasoningEffort?: string
}

/**
 * codex 的 effort 列表元素是 `{ reasoningEffort, description }` 对象，
 * **不是**裸字符串——第一版按 `entry.effort` 读，结果强度选择器整个不出现。
 * 探真实响应才发现字段名。裸字符串那条分支留着兜底，代价只有一行。
 */
function effortOf(entry: string | { reasoningEffort?: string }): string | undefined {
  return typeof entry === "string" ? entry : entry.reasoningEffort
}

export function toModelOption(raw: WireModel): ModelOption {
  const efforts = (raw.supportedReasoningEfforts ?? [])
    .map(effortOf)
    .filter((e): e is string => e !== undefined)
  const id = raw.id ?? raw.model ?? ""
  return {
    id,
    label: raw.displayName ?? id,
    ...(raw.description === undefined ? {} : { description: raw.description }),
    ...(efforts.length === 0 ? {} : { efforts }),
    ...(raw.defaultReasoningEffort === undefined ? {} : { defaultEffort: raw.defaultReasoningEffort }),
  }
}

/* ── 引擎自己存的会话 ─────────────────────────────
 * 同样是形状转换，所以也住这儿。
 */

/** 一条太长就没法当标题用了。preview 是整段提问，动辄几百字。 */
const TITLE_MAX = 60

/** 最多带回来这么多条。列表有 cursor，但侧栏里的一段不该是无底洞。 */
const HISTORY_MAX = 40

interface WireThreadRow {
  id?: string
  name?: string | null
  preview?: string | null
  cwd?: string | null
  updatedAt?: number | null
  recencyAt?: number | null
}

export function toEngineThreads(raw: unknown): readonly EngineThread[] {
  const rows = (raw as { data?: readonly WireThreadRow[] } | undefined)?.data ?? []
  const out: EngineThread[] = []
  for (const row of rows) {
    const handle = row.id ?? ""
    const cwd = row.cwd ?? ""
    // 没有句柄就接不过来，没有 cwd 工作区边界就错了——**两样缺一个都不给列**，
    // 列出来的下场是点了报错，那比看不见更糟
    if (handle === "" || cwd === "") continue
    out.push({
      handle,
      title: titleOf(row),
      cwd,
      // codex 报的是**秒**（和 rateLimits 的 resetsAt 同一个坑）
      updatedAt: (row.updatedAt ?? row.recencyAt ?? 0) * 1000,
    })
    if (out.length >= HISTORY_MAX) break
  }
  return out
}

/**
 * 这条会话在侧栏里叫什么。
 *
 * 优先用户起的名字；没有就拿 preview 的**第一行**——它是整段提问，
 * 里面常常有换行和代码块，整段塞进一行标题里只会看到一堆反引号。
 */
function titleOf(row: WireThreadRow): string {
  const named = (row.name ?? "").trim()
  if (named !== "") return named
  const first = (row.preview ?? "").split("\n").find((l) => l.trim() !== "")?.trim() ?? ""
  if (first === "") return "（没有标题）"
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX)}…` : first
}

/** 登录的账号。实测形状：`{account:{type,email,planType}}`，登出时 `account` 是 null。 */
export function toAccount(raw: unknown): EngineAccount | undefined {
  const account = (raw as { account?: { email?: string | null; planType?: string | null } | null } | undefined)?.account
  const label = (account?.email ?? "").trim()
  if (label === "") return undefined
  const plan = (account?.planType ?? "").trim()
  return { label, ...(plan === "" ? {} : { plan }) }
}
