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
 * 「Switchback 设的和引擎报的对不对得上」要知道 Switchback 当前是哪一档，那是驱动的事。
 * 和 `acp/mode.ts` 的 `modeAxis` 同一条边界：**这一层只把线上的形状翻成人话，
 * 判定留给知道上下文的那一层。**
 */

/** Switchback 关心的那几样。其余字段（personality、serviceTier…）一概不看。 */
export interface CodexSettings {
  /** 审批策略。 */
  approval?: string
  /** `auto_review` 就是权限菜单里的 “Approve for me”。 */
  reviewer?: string
  /** 沙箱。**线上是标签联合**（`{type:"read-only"}`），不是裸串——Switchback 发出去的那一份才是裸串。 */
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
 * 而 Switchback 在 `thread/start` 上发出去的是裸串。两边不同名不同形，
 * 只认一种的话换个入口就读不出来了。
 */
function sandboxOf(raw: unknown): string | undefined {
  if (typeof raw === "string") return str(raw)
  return str((raw as { type?: unknown } | undefined)?.type)
}

/** 从一条 `thread/settings/updated` 里取出 Switchback 关心的那几样。认不出的一律缺席。 */
export function readSettings(params: unknown): CodexSettings {
  const s = (params as { threadSettings?: Record<string, unknown> } | undefined)?.threadSettings
  if (s === undefined) return {}
  const approval = str(s["approvalPolicy"])
  const reviewer = str(s["approvalsReviewer"])
  const sandbox = sandboxOf(s["sandboxPolicy"])
  const model = str(s["model"])
  const effort = str(s["effort"])
  return {
    ...(approval === undefined ? {} : { approval }),
    ...(reviewer === undefined ? {} : { reviewer }),
    ...(sandbox === undefined ? {} : { sandbox }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  }
}

/**
 * 比对用的规范形。**显示仍然用引擎报的原文**——Switchback 不翻译它的值。
 *
 * ## 为什么需要它：**Switchback 发的和收的是两个类型，不是同一个值两种拼写**
 *
 * codex 的 app-server 在这件事上分了两个概念（`app-server-protocol/src/protocol/v2/`）：
 *
 * | 方向 | 类型 | 线上长相 |
 * | --- | --- | --- |
 * | Switchback 发（`thread/start` 的 `sandbox`） | `SandboxMode` | `"workspace-write"` |
 * | 引擎报（`thread/settings/updated`） | `SandboxPolicy`（`thread.rs` → `permissions.rs:538`，`rename_all = "camelCase"`） | `{"type":"workspaceWrite", …}` |
 *
 * 前者是**你要的档**，后者是**生效的策略**——两个标签一一对应，但既不同名也不同形。
 * 直接比字符串永远不等，界面上会给每条 codex 会话常亮一句「引擎那边现在是
 * workspaceWrite（不是 Switchback 切的）」，而它就是 Switchback 切的。
 *
 * 顺带记一笔踩过的坑：`codex-rs/protocol/src/protocol.rs` 里**另有**一个同名的
 * `SandboxPolicy`，那份是 kebab-case。**同一个仓库里同名类型有多份，
 * 读的时候必须确认读的是这条线上真正用的那一份**——照着另一份写，
 * 编译器一个字都不会说。
 */
export function canonical(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}
