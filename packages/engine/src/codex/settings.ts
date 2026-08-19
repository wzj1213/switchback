/**
 * codex 报上来的**一份设置快照**（`thread/settings/updated`）。
 *
 * ## 为什么这是 codex 唯一的档位回读
 *
 * 它是 app-server 里唯一会主动说「我现在是什么档」的通知，而且带的是**生效后**的
 * 整份快照，不是一个增量。代价是它藏在实验面后面——不认领 `experimentalApi`
 * 就一条都收不到（见 `claims.ts`）。
 *
 * ## 为什么这里只翻译、不判对齐
 *
 * 「omni 设的和引擎报的对不对得上」要知道 omni 当前是哪一档，那是驱动的事。
 * 和 `acp/mode.ts` 的 `modeAxis` 同一条边界：**这一层只把线上的形状翻成人话，
 * 判定留给知道上下文的那一层。**
 */

/** omni 关心的那几样。其余字段（personality、serviceTier…）一概不看。 */
export interface CodexSettings {
  /** 审批策略。omni 自己设的是 `untrusted` / `on-request`（见 `sandbox.ts` 的 `POLICY`）。 */
  approval?: string
  /** 沙箱。**线上是标签联合**（`{type:"read-only"}`），不是裸串——omni 发出去的那一份才是裸串。 */
  sandbox?: string
  model?: string
  effort?: string
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)

/**
 * 沙箱那一格：**两种形状都认**。
 *
 * codex 自己的 `SandboxPolicy` 序列化成 `{"type":"read-only", …}`
 *（Rust 侧 `#[serde(tag = "type", rename_all = "kebab-case")]`），
 * 而 omni 在 `thread/start` 上发出去的是裸串。两边不同名不同形，
 * 只认一种的话换个入口就读不出来了。
 */
function sandboxOf(raw: unknown): string | undefined {
  if (typeof raw === "string") return str(raw)
  return str((raw as { type?: unknown } | undefined)?.type)
}

/** 从一条 `thread/settings/updated` 里取出 omni 关心的那几样。认不出的一律缺席。 */
export function readSettings(params: unknown): CodexSettings {
  const s = (params as { threadSettings?: Record<string, unknown> } | undefined)?.threadSettings
  if (s === undefined) return {}
  const approval = str(s["approvalPolicy"])
  const sandbox = sandboxOf(s["sandboxPolicy"])
  const model = str(s["model"])
  const effort = str(s["effort"])
  return {
    ...(approval === undefined ? {} : { approval }),
    ...(sandbox === undefined ? {} : { sandbox }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  }
}

/**
 * 比对用的规范形。**显示仍然用引擎报的原文**——omni 不翻译它的值。
 *
 * ## 为什么非要有这一步
 *
 * 实测（`codex app-server`，2026-08-19）：omni 在 `thread/start` 发出去的是
 * `sandbox: "workspace-write"`，而 `thread/settings/updated` 报回来的是
 * `{"type":"workspaceWrite"}`——**同一个值，两种拼写**。
 *（源码上标的是 `rename_all = "kebab-case"`，线上却是驼峰，所以这一条只能靠实跑发现。）
 *
 * 直接比字符串的话两边永远不等，界面上会给每一条 codex 会话常亮一句
 *「引擎那边现在是 workspaceWrite（不是 omni 切的）」——而它就是 omni 切的。
 * 那是这一批要消灭的那类谎，只是反过来。
 */
export function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}
