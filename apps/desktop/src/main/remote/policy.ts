import type { Command, RememberScope, Trust } from "@omni/protocol"

/**
 * 远程客户端能做什么。**这台机器上跑着一个有写和执行权限的 agent**，
 * 而远程那一端是一部会丢的手机。
 *
 * ## 上限是「档位」，不是「命令白名单」
 *
 * 白名单要逐条维护，而 `Command` 每加一项就得记得回来加一行——忘了的那次，
 * 新命令是**默认放行**的。改成钳制档位：远程能发的命令和桌面一样多，
 * 但它开出来的会话、它切到的档位，都不会高过这条线。**多一条命令不改变权限面。**
 *
 * ## 为什么审批仍然放行
 *
 * 「在外面把卡住的那一轮放行」正是这个功能存在的理由。拦掉它等于把主用途拦了。
 *
 * 但**记忆范围要收**：一次性批准只影响这一次，而 `project` 级规则会落盘、
 * 跨会话生效——那是在一块小屏幕上做一个长期决定。所以完全档以下，
 * 远程的 `project` 一律降成 `session`。它仍然「不再问了」，只是不跨会话。
 */

const RANK: Readonly<Record<Trust, number>> = { "read-only": 0, "auto-edit": 1, full: 2 }

/** 两个档位里更保守的那个。 */
export function lower(a: Trust, b: Trust): Trust {
  return RANK[a] <= RANK[b] ? a : b
}

/** 钳过之后的命令，以及**哪里被钳了**——界面要能说清「为什么我选的是完全档，它却是只读」。 */
export interface Clamped {
  command: Command
  /** 有值就说明这条命令被改过。写给人看。 */
  note?: string
}

function clampScope(scope: RememberScope, ceiling: Trust): { scope: RememberScope; note?: string } {
  if (ceiling === "full" || scope !== "project") return { scope }
  return { scope: "session", note: "远程批准只记到本会话；要记成项目级规则请在桌面上勾" }
}

/**
 * 把一条远程发来的命令钳到上限之内。
 * @param ceiling 远程连接的档位上限，来自 `Settings.remote.maxTrust`。
 */
export function clamp(command: Command, ceiling: Trust): Clamped {
  if (command.type === "thread.create") {
    const trust = lower(command.trust, ceiling)
    return trust === command.trust
      ? { command }
      : { command: { ...command, trust }, note: `远程新建的会话按 ${trust} 开（上限）` }
  }
  if (command.type === "thread.setTrust") {
    const trust = lower(command.trust, ceiling)
    return trust === command.trust
      ? { command }
      : { command: { ...command, trust }, note: `远程最高只能切到 ${trust}` }
  }
  if (command.type === "approval.resolve") {
    const { scope, note } = clampScope(command.remember, ceiling)
    return scope === command.remember ? { command } : { command: { ...command, remember: scope }, ...(note === undefined ? {} : { note }) }
  }
  return { command }
}

/**
 * 这一坨东西真的是一条 `Command` 吗。
 *
 * **线上来的是任意 JSON**，而 `host.dispatch` 认的是一个判别联合。
 * 不验就等于把「随便什么形状」喂进宿主——最好的情况是抛异常，
 * 最坏的情况是某个分支恰好读到了它不该读的字段。
 *
 * 只验形状（有没有一个已知的 `type`、必需字段在不在），不验语义
 *（会话存不存在、路径合不合法）——那些是宿主自己的判断，重复一遍必然分岔。
 */
/**
 * 按名字取形状。**必须查自有属性**——`SHAPES["__proto__"]` 拿到的是
 * `Object.prototype`，一个真值；后面那句 `shape.strings.every(...)` 于是
 * 在 `undefined` 上调方法，整个请求处理抛出去。一条线上来的
 * `{"type":"__proto__"}` 就能触发。（这条是被测试逮到的，不是想出来的。）
 */
function shapeOf(type: unknown): Shape | undefined {
  if (typeof type !== "string" || !Object.hasOwn(SHAPES, type)) return undefined
  return SHAPES[type]
}

export function isCommand(value: unknown): value is Command {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const shape = shapeOf(record["type"])
  if (shape === undefined) return false
  if (!shape.strings.every((f) => typeof record[f] === "string")) return false
  if (!(shape.booleans ?? []).every((f) => typeof record[f] === "boolean")) return false
  return Object.entries(shape.enums ?? {}).every(([field, allowed]) => {
    const seen = record[field]
    return typeof seen === "string" && allowed.includes(seen)
  })
}

const TRUSTS: readonly string[] = ["read-only", "auto-edit", "full"]
const SCOPES: readonly string[] = ["once", "session", "project"]

interface Shape {
  /** 必需的字符串字段。 */
  strings: readonly string[]
  /**
   * 必需的**布尔**字段。
   *
   * 单独列出来不是洁癖：`approval.resolve` 的 `allow` 缺席时是 `undefined`，
   * 而后面每一处都按 falsy 读——于是一条缺字段的命令会**静默变成「拒绝」**，
   * 用户在手机上点了「允许」，工具被拒，界面上没有任何东西说这里出了错。
   */
  booleans?: readonly string[]
  /** 取值受限的字段。挡的是「类型对但值不对」——那种会一路走到引擎才炸。 */
  enums?: Readonly<Record<string, readonly string[]>>
}

/**
 * 每种命令的必需字段。可选字段（`title` / `model` / `attachments`…）不在这里——
 * 它们缺席是合法的。
 */
const SHAPES: Readonly<Record<string, Shape>> = {
  "thread.adopt": { strings: ["engine", "handle", "cwd", "title"] },
  "thread.create": { strings: ["cwd", "engine"], enums: { trust: TRUSTS } },
  "thread.prompt": { strings: ["threadId", "text"] },
  "thread.interrupt": { strings: ["threadId"] },
  "thread.unqueue": { strings: ["threadId"] },
  "thread.compact": { strings: ["threadId"] },
  "thread.rewind": { strings: ["threadId", "turnId"] },
  "thread.setTrust": { strings: ["threadId"], enums: { trust: TRUSTS } },
  "thread.rename": { strings: ["threadId", "title"] },
  "thread.resume": { strings: ["threadId"] },
  "thread.delete": { strings: ["threadId"] },
  "thread.fork": { strings: ["threadId", "to"] },
  "thread.setModel": { strings: ["threadId", "model"] },
  "thread.handoff": { strings: ["threadId", "to"] },
  "approval.resolve": { strings: ["itemId"], booleans: ["allow"], enums: { remember: SCOPES } },
}
