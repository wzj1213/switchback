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

/**
 * 钳过之后的命令，以及**哪里被钳了**——界面要能说清「为什么我选的是完全档，它却是只读」。
 *
 * `refused` 是第三种结局：有些命令**没法钳**，只能整条挡下。
 * 那时 `command` 是 undefined，调用方必须把 `note` 送回给用户看——
 * 静默丢弃是这条通道上最坏的失败方式。
 */
export type Clamped =
  | { command: Command; note?: string }
  | { command?: undefined; refused: true; note: string }

function clampScope(scope: RememberScope, ceiling: Trust): { scope: RememberScope; note?: string } {
  if (ceiling === "full" || scope !== "project") return { scope }
  return { scope: "session", note: "远程批准只记到本会话；要记成项目级规则请在桌面上勾" }
}

/**
 * 这条命令会不会让引擎在一条**高过上限**的会话里动起来。
 *
 * ## 为什么光钳「新建」和「切档」不够
 *
 * 上限的承诺是「远程能改文件，但每条命令仍然要你点一次」。而一条**桌面上
 * 已经开着的完全档会话**从来不经过 `thread.create`——远程只要往它发一句
 * `thread.prompt`，引擎就按那条会话自己的完全档跑，一次审批都不弹。
 * `thread.fork` 更直接：`@omni/host` 的 branch 里是 `{...entry.thread}`，
 * 新会话**继承源会话的档**，于是远程凭空得到一条完全档会话。
 *
 * 所以判据从「这条命令要开哪一档」改成「这条命令作用在哪条会话上」。
 *
 * 挡的是会让引擎动起来的那几条；`interrupt` / `rename` / `delete` /
 * `setModel` / `approval.resolve` 不在内——**批准尤其不能拦**，
 * 那是这个功能存在的理由。`question.resolve` 同理：只回答一张已经挂起的卡，
 * 不会自行让引擎获得更高权限。
 */
const RUNS_IN_THREAD: ReadonlySet<string> = new Set([
  "thread.prompt",
  "thread.resume",
  "thread.rewind",
  "thread.fork",
  // 它让引擎在那条会话里**立刻动起来**（换引擎并重开一轮），所以和上面几条同一档
  "thread.switchNow",
  // **侧问也算「让引擎动起来」**：它照样把话递进那条会话所在的引擎进程。
  // 不进这一档的话，一条开在 `full` 档、高过远程上限的会话可以被手机侧问——
  // 而侧问用的是同一个进程、同一份工作区权限
  "thread.sideQuestion",
])

/**
 * 把一条远程发来的命令钳到上限之内。
 * @param ceiling 远程连接的档位上限，来自 `Settings.remote.maxTrust`。
 * @param trustOf 目标会话现在是哪一档。查不到（比如会话不存在）就当没有约束——
 *   宿主自己会拒一条指向不存在会话的命令，这里不重复那份判断。
 */
export function clamp(command: Command, ceiling: Trust, trustOf?: (id: string) => Trust | undefined): Clamped {
  const target = "threadId" in command ? trustOf?.(command.threadId) : undefined
  if (target !== undefined && RUNS_IN_THREAD.has(command.type) && RANK[target] > RANK[ceiling]) {
    return {
      refused: true,
      note: `这条会话开在 ${target} 档，高过远程上限 ${ceiling}。先在手机上把它切到 ${ceiling}（切低是允许的），或者在桌面上调高远程上限。`,
    }
  }
  return clampTrust(command, ceiling)
}

function clampTrust(command: Command, ceiling: Trust): Clamped {
  if (command.type === "thread.adopt") {
    // **接管没有档位可钳。** `@omni/host` 的 `adopt` 把 trust 写死成 `auto-edit`
    //（它不猜那条会话原本在引擎里是什么档，猜错的方向如果是放宽就麻烦了）。
    // 于是只读上限对它完全无效：远程白拿一条能改文件的会话。
    // 命令里也没有 trust 字段可改，所以只能整条挡下——
    // **钳不动的东西必须拒，不能放过去**。
    if (ceiling === "read-only") {
      return { refused: true, note: "远程上限是只读，而接管过来的会话固定开在自动审批档，所以这一步只能在桌面上做" }
    }
    return { command }
  }
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
  if (!(shape.optionalStrings ?? []).every((f) => record[f] === undefined || typeof record[f] === "string")) return false
  if (!(shape.booleans ?? []).every((f) => typeof record[f] === "boolean")) return false
  if (!(shape.objects ?? []).every((f) => typeof record[f] === "object" && record[f] !== null && !Array.isArray(record[f]))) return false
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
  /** 存在时必须是字符串；缺席合法。 */
  optionalStrings?: readonly string[]
  /**
   * 必需的**布尔**字段。
   *
   * 单独列出来不是洁癖：`approval.resolve` 的 `allow` 缺席时是 `undefined`，
   * 而后面每一处都按 falsy 读——于是一条缺字段的命令会**静默变成「拒绝」**，
   * 用户在手机上点了「允许」，工具被拒，界面上没有任何东西说这里出了错。
   */
  booleans?: readonly string[]
  /** 必需的普通对象；对象内部的语义由宿主按当前现场校验。 */
  objects?: readonly string[]
  /** 取值受限的字段。挡的是「类型对但值不对」——那种会一路走到引擎才炸。 */
  enums?: Readonly<Record<string, readonly string[]>>
}

/**
 * 每种命令的必需字段。可选字段（`title` / `model` / `attachments`…）不在这里——
 * 它们缺席是合法的。
 */
const SHAPES: Readonly<Record<string, Shape>> = {
  "thread.adopt": { strings: ["engine", "handle", "cwd", "title"], optionalStrings: ["profile"] },
  "thread.create": { strings: ["cwd", "engine"], enums: { trust: TRUSTS } },
  "thread.prompt": { strings: ["threadId", "text"] },
  "thread.sideQuestion": { strings: ["threadId", "text"] },
  "thread.interrupt": { strings: ["threadId"] },
  "thread.unqueue": { strings: ["threadId"] },
  // **这两条是补上的，原来漏了。** 漏掉的后果不是放行而是整条拒掉
  //（回一句「形状认不出来」），而 `steerQueued` 恰恰是最赶时间的那个动作：
  // 排着的那句往往是「别再往下走了」
  "thread.steerQueued": { strings: ["threadId"] },
  "thread.switchNow": { strings: ["threadId"] },
  "thread.compact": { strings: ["threadId"] },
  // `draft` / `draftAttachments` 是可选的，按本表的规矩不列（缺席合法）；
  // 类型不对时宿主那边照旧当没给——`branch()` 只认字符串
  "thread.rewind": { strings: ["threadId", "turnId"] },
  "thread.setTrust": { strings: ["threadId"], enums: { trust: TRUSTS } },
  "thread.rename": { strings: ["threadId", "title"] },
  "thread.resume": { strings: ["threadId"] },
  "thread.delete": { strings: ["threadId"] },
  "thread.fork": { strings: ["threadId", "to"] },
  "thread.setModel": { strings: ["threadId", "model"] },
  "thread.handoff": { strings: ["threadId", "to"] },
  "approval.resolve": { strings: ["itemId"], booleans: ["allow"], enums: { remember: SCOPES } },
  "question.resolve": { strings: ["threadId", "questionId"], objects: ["response"] },
}
