/**
 * 审核面板的数据形状。
 *
 * ## 为什么不复用工具行那份 `FileChange`
 *
 * 两者的来源和置信度都不同，混成一个类型会让「这份补丁能不能信」变成一件
 * 要看上下文才知道的事：
 *
 * - `FileChange` 是**引擎自己报的**。它只覆盖引擎用编辑工具做的改动，
 *   而且 `kind` 决定 `diff` 字段的格式——`add`/`delete` 时递过来的是**文件全文**，
 *   不带任何 `+`/`-` 前缀（见 `renderer/diff.ts` 的 `parseDiff`）。
 * - `ReviewFile` 是**问 git 得来的**。它覆盖工作区里所有变了的文件（包括引擎用
 *   shell 写的、你自己改的），而 `patch` **永远是真正的 unified diff**，
 *   新建文件也一样带 `@@` 头和 `+` 前缀——那是 git 自己的输出，不是我们拼的。
 *
 * 所以渲染这一份时永远按 `"update"` 解析，`kind` 只用来画那枚徽标。
 */

/** `?` 是未跟踪：git 眼里它还不存在，但工作区里它在。 */
export type ReviewKind = "add" | "delete" | "update" | "rename" | "untracked"

export interface ReviewFile {
  /** 绝对真实路径。要在访达里定位、要和引擎报的路径对得上，都靠它。 */
  path: string
  /** 相对仓库根。界面上显示这个——绝对路径在侧栏里长得没法看。 */
  rel: string
  kind: ReviewKind
  /** 重命名时的旧名（相对仓库根）。 */
  from?: string
  added: number
  removed: number
  /** 改动已经进了暂存区。审核时要知道，因为 `git diff` 默认看不见它们。 */
  staged?: boolean
}

/** 不给正文的两种理由。**仍然出现在列表里**——藏起来等于假装它没变。 */
export type PatchSkip = "binary" | "large" | "gone"

export interface ReviewPatch {
  /** 真正的 unified diff。`skip` 有值时是空串。 */
  patch: string
  skip?: PatchSkip
  added: number
  removed: number
}

const KIND_LABEL: Readonly<Record<ReviewKind, string>> = {
  add: "新建",
  delete: "删除",
  update: "修改",
  rename: "改名",
  untracked: "未跟踪",
}

export function reviewLabel(kind: ReviewKind): string {
  return KIND_LABEL[kind]
}

/**
 * porcelain 的两位状态码 → 我们的分类。
 *
 * 第一位是暂存区、第二位是工作区，`git` 的规矩。取「更能说明这个文件发生了什么」
 * 的那一位：`AM`（新加的又改了）算新建，`MD`（改了又删了）算删除。
 */
export function kindOf(code: string): ReviewKind {
  if (code.startsWith("?")) return "untracked"
  const marks = code.replace(/ /g, "")
  if (marks.includes("D")) return "delete"
  if (marks.includes("R")) return "rename"
  if (marks.includes("A")) return "add"
  return "update"
}

/** 第一位不是空格也不是 `?` 就说明暂存区里有它的一份。 */
export function isStaged(code: string): boolean {
  const first = code[0]
  return first !== undefined && first !== " " && first !== "?"
}

/**
 * `git diff --numstat -z` 的输出。
 *
 * 普通的一段是 `<added>\t<removed>\t<path>`，而**改名那种不是**：路径那栏是空的，
 * 后面跟着两段独立的 NUL 字段——旧名、新名。实测：
 *
 * ```
 * 0\t1\tgone.txt\0  2\t1\tkeep.txt\0  0\t0\t\0 old.txt\0 new.txt\0
 * ```
 *
 * 按普通格式硬解，改名的那条会被整个丢掉（第三栏是空串），
 * 而它后面那两段又会被当成两条残缺记录——**列表上那个文件的增删数会静静地变成 0**。
 *
 * 二进制文件的两栏是 `-`。`Number("-")` 是 NaN，`|| 0` 兜成 0——
 * 这是有意的：二进制文件本来就没有「行数」可言，补丁那边会另外标出来。
 */
export function parseNumstat(raw: string): ReadonlyMap<string, { added: number; removed: number }> {
  const out = new Map<string, { added: number; removed: number }>()
  const parts = raw.split("\0")
  for (let i = 0; i < parts.length; i += 1) {
    const cols = (parts[i] ?? "").split("\t")
    if (cols.length < 3) continue
    const [a, d, rel] = cols
    const stat = { added: Number(a) || 0, removed: Number(d) || 0 }
    if (rel !== undefined && rel !== "") {
      out.set(rel, stat)
      continue
    }
    // 改名：接下来是旧名、新名。**记在新名下**——列表显示的是新名
    const to = parts[i + 2]
    if (to !== undefined && to !== "") out.set(to, stat)
    i += 2
  }
  return out
}

/** 前 8 KB 里有 NUL 就当二进制。git 自己用的也是这个近似。 */
export function looksBinary(buf: Uint8Array): boolean {
  const end = Math.min(buf.length, 8192)
  for (let i = 0; i < end; i += 1) if (buf[i] === 0) return true
  return false
}
