import type { Request as ApprovalRequest } from "@omni/approval"
import type { RememberScope } from "@omni/protocol"
import { sanitize } from "../claude/permission.js"
import { detailOf, toolNameOf } from "./translate.js"
import type { AcpPermissionOption, AcpToolCall } from "./wire.js"

/**
 * ACP 的审批请求 ↔ `@omni/approval`。
 *
 * ## 第三家，第三种形状
 *
 * | | 审批请求里有什么 | 我们回什么 |
 * | --- | --- | --- |
 * | Claude SDK | 完整工具名 + 完整参数 | allow / deny |
 * | codex app-server | 只有 `itemId`（指回之前那条通知） | 固定枚举 `accept` / `decline` / … |
 * | ACP | 只有 `toolCallId` + kind + status | **agent 自己给的一张选项表，按 optionId 回** |
 *
 * 实测 codex-acp 的请求体，一个字都不多：
 *
 * ```json
 * {"toolCall":{"toolCallId":"exec-3b86…","kind":"edit","status":"pending"},
 *  "options":[{"optionId":"allow_once","kind":"allow_once","name":"Allow Once"}, …]}
 * ```
 *
 * 标题、diff、命令**一个都没有**——它们在上一条 `session/update` 里。
 * 所以驱动必须留着在途表，和 codex 那边是同一个教训。
 *
 * 而回应这一侧是 ACP 独有的麻烦：`optionId` 是 **agent 定义的不透明字符串**，
 * 不是协议枚举。这次它恰好等于 `kind`，下一家可能是 `"opt-3"`。
 * 所以只能按 `kind` 挑，挑不到就按下面的降级规则来——**绝不跨极性降级**。
 */

/** 想要哪一种，按偏好从高到低。挑不到就往同极性的下一个退。 */
const ALLOW_ORDER: Readonly<Record<"once" | "always", readonly string[]>> = {
  once: ["allow_once", "allow_always"],
  always: ["allow_always", "allow_once"],
}

const REJECT_ORDER: Readonly<Record<"once" | "always", readonly string[]>> = {
  once: ["reject_once", "reject_always"],
  always: ["reject_always", "reject_once"],
}

/**
 * 挑一个选项。
 *
 * **注意降级只在同极性内进行。** 想拒却只有 allow 选项时返回 `undefined`，
 * 由调用方回 `cancelled` —— 绝不能因为「总得选一个」就把拒绝降级成放行。
 * 反过来也一样：想放行却只有 reject，那就拒，不去猜用户其实想过。
 *
 * 记忆范围往 ACP 的两档上折：`once` 之外的都算 `always`。
 * ACP 只有「这次」和「记住」两种，表达不了 omni 的 session / project 之分——
 * 这个差额由 omni 自己的规则库补上，不指望引擎替我们记。
 */
export function pickOption(
  options: readonly AcpPermissionOption[],
  allow: boolean,
  remember: RememberScope,
): string | undefined {
  const order = (allow ? ALLOW_ORDER : REJECT_ORDER)[remember === "once" ? "once" : "always"]
  for (const want of order) {
    const hit = options.find((o) => o.kind === want && o.optionId !== undefined)
    if (hit?.optionId !== undefined) return hit.optionId
  }
  // kind 缺失的老实现：按 optionId 名字兜一次底，还是不跨极性
  const prefix = allow ? "allow" : "reject"
  return options.find((o) => o.optionId?.startsWith(prefix) === true)?.optionId
}

/** 判定用的命令原文。**只认 `rawInput.command`**，理由见 `argsOf`。 */
function commandOf(call: AcpToolCall): string | undefined {
  const raw = call.rawInput?.["command"]
  return typeof raw === "string" && raw !== "" ? raw : undefined
}

function argsOf(call: AcpToolCall | undefined): Record<string, unknown> {
  if (call === undefined) return {}
  const detail = detailOf(call)
  if (detail.kind === "shell") {
    /**
     * **命令原文只认 `rawInput`，不能退回 `title`。**
     *
     * `detailOf` 缺 `rawInput` 时会退回 `title`——给人看没问题（"Bash"、
     * "Running: ls -la" 总比空着好），但把它当命令送去判定就是**拿展示文本
     * 冒充事实**：实测 kimi 审批时的 title 就是 `"Bash"`，于是
     * `splitSegments("Bash")` 得到一条叫 Bash 的无害命令，
     * 靠命令原文的那 8 条红线（凭据读取、越界删除、`npm i -g`、`git push`、
     * 解析不了…）**一条都匹配不上**，然后按档位静默放行。
     *
     * 缺席比编一个好：`command` 不在，判定器就按「看不见」办（落 `unknown`，
     * 只读档 deny、自动编辑档 escalate），而不是以为自己看清了。
     */
    const command = commandOf(call)
    return {
      ...(command === undefined ? {} : { command }),
      ...(detail.cwd === undefined ? {} : { cwd: detail.cwd }),
    }
  }
  if (detail.kind === "file_edit") {
    const paths = detail.files.map((f) => f.path).filter((p) => p !== "")
    const all = paths.length === 0 && detail.path !== "" ? [detail.path] : paths
    return { paths: all, ...(all[0] === undefined ? {} : { path: all[0] }) }
  }
  if (detail.kind === "file_read") return { path: detail.path }
  if (detail.kind === "fetch") return { url: detail.url }
  return { ...(call.rawInput ?? {}) }
}

const MAX_FILES = 3

/**
 * 给人看的一句话。
 *
 * ACP 的 `title` 是 agent 写好的人话（"Read file '/tmp/x/hello.txt'"），
 * 有它就用它——比我们从 kind 反推出来的强。**但它是引擎给的文本，
 * 必须转义**：一条能往审批卡里塞标记的标题，就是一条能骗用户点「允许」的标题。
 *
 * 没有 title 时照实说「详情未送达」。一张写着「批准吗？」却不说批准什么的卡片，
 * 比不弹卡片更糟。
 */
function editSummary(files: readonly { path: string }[]): string {
  const paths = files.map((f) => f.path).filter((p) => p !== "")
  if (paths.length === 0) return "修改文件（详情未送达）"
  const shown = paths.slice(0, MAX_FILES).map((p) => sanitize(p)).join("、")
  const more = paths.length > MAX_FILES ? ` 等 ${String(paths.length)} 个文件` : ""
  return `修改 ${shown}${more}`
}

function detailSummary(call: AcpToolCall): string {
  const detail = detailOf(call)
  if (detail.kind === "shell" && detail.command !== "") return `执行 ${sanitize(detail.command)}`
  if (detail.kind === "file_edit") return editSummary(detail.files)
  if (detail.kind === "file_read") return `读取 ${sanitize(detail.path)}`
  if (detail.kind === "fetch") return `访问 ${sanitize(detail.url)}`
  return `执行 ${sanitize(toolNameOf(call.kind))}（详情未送达）`
}

export function summarize(call: AcpToolCall | undefined): string {
  const title = call?.title
  if (title !== undefined && title !== null && title !== "") return sanitize(title)
  if (call === undefined) return "执行一项操作（详情未送达）"
  return detailSummary(call)
}

/**
 * 判定用的请求。
 *
 * `toolLabel` 带上 agent 给的 `title` **原文**（不是 `summarize` 那份转义过的）：
 * ACP 的工具身份是 `kind`，而各家往那张短枚举上映射是**有损的**——实测 kimi 只认
 * 十个名字，k3 那套工具（`Shell`、`ReadFile`…）全报 `other`，于是每条简单命令
 * 在自动编辑档下都要弹一次窗。`title` 是这时候唯一还认得出方向的东西。
 * 判定器只在 `kind` 认不出来时才看它，见 `@omni/approval` 的 `NAME_CATEGORY`。
 */
export function buildRequest(
  engine: string,
  call: AcpToolCall | undefined,
  cwd: string,
): ApprovalRequest {
  const label = call?.title ?? ""
  return {
    engine,
    tool: toolNameOf(call?.kind),
    ...(label === "" ? {} : { toolLabel: label }),
    args: argsOf(call),
    cwd,
    summary: summarize(call),
  }
}
