import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ipcMain, shell } from "electron"
import type { WorksiteSearch } from "./worksite-search.js"
import { ownedWorksite, type OwnedWorksite, type WorksiteGuard } from "./worksite-search.js"

/**
 * 项目说明：一份真源，两家引擎都读得到。
 *
 * ## 为什么不是各写一份
 *
 * codex 原生读 `AGENTS.md`，Claude 原生读 `CLAUDE.md`。各写一份的结果是
 * **同一件事有两份真源**——改了一边忘了另一边，而两家的行为就此分岔，
 * 却没有任何地方会报错。这正是 omni 要消灭的那类问题（换内核不换工具，
 * 那说明也不该跟着内核分家）。
 *
 * ## 用的什么机制
 *
 * `CLAUDE.md` 里只写一行 `@AGENTS.md`。**这不是猜的**：
 * 实测建一个只有 `@AGENTS.md` 的 CLAUDE.md，把暗号写进 AGENTS.md，
 * Claude 答得出那个暗号——说明它确实顺着引用读了过去。
 *
 * 于是真源只有 `AGENTS.md` 一份，`CLAUDE.md` 是一行指路牌。
 */
const AGENTS = "AGENTS.md"
const CLAUDE = "CLAUDE.md"
const POINTER = "@AGENTS.md"

export interface ProjectDoc {
  /** 真源在不在。 */
  agents: boolean
  /** `CLAUDE.md` 在不在。 */
  claude: boolean
  /** `CLAUDE.md` 是不是那行指路牌（而不是另一份各写各的内容）。 */
  linked: boolean
  /** 真源的绝对路径，给「打开」用。 */
  path: string
  /** 请求不属于一条真实会话时，不碰文件系统，也不画一个假的创建入口。 */
  denied?: true
}

export type ProjectDocGuard = WorksiteGuard

const STARTER = `# 项目说明

写给在这个项目里干活的 agent 看。**两家引擎读的是同一份**——
\`CLAUDE.md\` 只有一行 \`@AGENTS.md\` 指到这里。

## 这是个什么项目

（一两句话说清它是干什么的、给谁用的）

## 动手前要知道的

- （构建/测试怎么跑）
- （哪些地方不要碰）

## 约定

- （代码风格、提交信息、命名之类，只写和别处不一样的那些）
`

function requestOf(value: unknown, owns: ProjectDocGuard): OwnedWorksite | undefined {
  return ownedWorksite(value, owns)
}

function denied(): ProjectDoc {
  return { agents: false, claude: false, linked: false, path: "", denied: true }
}

export async function projectDoc(value: unknown, owns: ProjectDocGuard): Promise<ProjectDoc> {
  const req = requestOf(value, owns)
  return req === undefined ? denied() : read(req.cwd)
}

export async function ensureProjectDoc(value: unknown, owns: ProjectDocGuard): Promise<ProjectDoc> {
  const req = requestOf(value, owns)
  if (req === undefined) return denied()
  const before = await read(req.cwd)
  if (!before.agents) await writeFile(join(req.cwd, AGENTS), STARTER, "utf8")
  // 只在「压根没有」时写指路牌。人家自己写过 CLAUDE.md 的话，
  // 那是他的内容，我们没有资格替他扔掉
  if (!before.claude) await writeFile(join(req.cwd, CLAUDE), `${POINTER}\n`, "utf8")
  return read(req.cwd)
}

export function installProjectDocChannel(worksites: WorksiteSearch): void {
  ipcMain.handle("omni:projectDoc", (_e, req: unknown) => projectDoc(req, worksites.owns))

  /** 建起来：缺什么补什么。**已经有内容的 `CLAUDE.md` 绝不覆盖**。 */
  ipcMain.handle("omni:ensureProjectDoc", (_e, req: unknown) => ensureProjectDoc(req, worksites.owns))

  ipcMain.handle("omni:openProjectDoc", async (_e, value: unknown) => {
    const req = requestOf(value, worksites.owns)
    if (req !== undefined) await shell.openPath(join(req.cwd, AGENTS))
  })
}

async function read(cwd: string): Promise<ProjectDoc> {
  const agents = await readFile(join(cwd, AGENTS), "utf8").catch(() => undefined)
  const claude = await readFile(join(cwd, CLAUDE), "utf8").catch(() => undefined)
  return {
    agents: agents !== undefined,
    claude: claude !== undefined,
    // 指路牌可以带注释和空行，只要它引用了真源就算数
    linked: claude !== undefined && claude.includes(POINTER),
    path: join(cwd, AGENTS),
  }
}
