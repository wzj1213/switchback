import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { ipcMain } from "electron"
import { homeOf } from "./envengines.js"

/**
 * **各家引擎自己的设置在哪儿。**
 *
 * ## omni 在这件事上只做一件事：把门指出来
 *
 * 不解析、不改写、不在 omni 里再造一套表单。理由写在 `AGENTS.md` 的产品边界总纲里：
 * omni 与引擎是共建者，不是上下级。它们各自的配置格式、默认值、生效时机都是它们的事，
 * omni 抄一份进来就得跟着它们改——而厂商改的时候不会通知我们，
 * 于是界面上摆着一份**过期的、看起来还能用的**设置。
 *
 * 反过来，「配置在哪儿」这件事 omni 是知道的（它本来就要读这些文件算钩子），
 * 而用户往往不知道。把路径摆出来 + 一颗「打开」，正好落在两者之间。
 *
 * ## 为什么要报 `exists`
 *
 * 「这个文件还没有」和「这个文件里什么都没配」是两件事，而它们都表现为「没效果」。
 * 分开说才答得了「我配了为什么不生效」——那正是用户会来这一页的原因。
 */
export interface EngineDoor {
  /** 引擎 id，和注册表一致。 */
  id: string
  label: string
  /** 用户级还是项目级。项目级那几条只在有当前工作区时才有。 */
  scope: "user" | "project" | "managed"
  path: string
  exists: boolean
  /** 一句话说明这份管什么。**不解释格式**——那是引擎自己文档的事。 */
  note: string
}

type Door = Omit<EngineDoor, "exists">

function dshDoors(): readonly Door[] {
  const home = homeOf("DSH_HOME", ".dsh")
  return [
    {
      id: "dsh",
      label: "DSH",
      scope: "user",
      path: join(home, "settings.yaml"),
      note: "模型、权限与通用偏好",
    },
    {
      id: "dsh",
      label: "DSH",
      scope: "user",
      path: join(home, "profiles", "acp", "cordis.patch.yml"),
      note: "omni 使用的 ACP profile；增删请走 dsh plugin",
    },
  ]
}

/** 各家的配置文件在哪。**家目录认各自的环境变量**，改过家目录的人正是最需要这一页的。 */
function layout(cwd: string | undefined): readonly Door[] {
  const project = (rest: string): readonly string[] => (cwd === undefined ? [] : [join(cwd, rest)])
  const rows: Door[] = [
    {
      id: "claude",
      label: "Claude Code",
      scope: "user",
      path: join(homedir(), ".claude", "settings.json"),
      note: "权限、钩子、模型默认值",
    },
    {
      id: "codex",
      label: "Codex",
      scope: "user",
      path: join(homeOf("CODEX_HOME", ".codex"), "config.toml"),
      note: "沙箱、审批策略、模型",
    },
    {
      id: "kimi",
      label: "Kimi Code",
      scope: "user",
      path: join(homeOf("KIMI_CODE_HOME", ".kimi-code"), "config.toml"),
      note: "思考档、循环控制、后台任务",
    },
    {
      id: "grok",
      label: "Grok",
      scope: "managed",
      path: join(homeOf("GROK_HOME", ".grok"), "managed_config.toml"),
      note: "由 Grok 自己维护，一般不手改",
    },
    {
      id: "grok",
      label: "Grok",
      scope: "user",
      path: join(homeOf("GROK_HOME", ".grok"), "config.toml"),
      note: "你自己的那份",
    },
    ...dshDoors(),
  ]
  for (const [id, label, rest, note] of [
    ["claude", "Claude Code", join(".claude", "settings.json"), "只对这个项目生效"],
    ["codex", "Codex", join(".codex", "config.toml"), "只对这个项目生效"],
    ["grok", "Grok", join(".grok", "config.toml"), "只对这个项目生效"],
  ] as const) {
    for (const path of project(rest)) rows.push({ id, label, scope: "project", path, note })
  }
  return rows
}

/** 读一遍盘看哪几份真的在。**读不到当不存在**——这一页不该因为权限问题整个空掉。 */
export async function engineDoors(cwd: string | undefined): Promise<readonly EngineDoor[]> {
  return Promise.all(
    layout(cwd).map(async (row) => ({
      ...row,
      exists: await stat(row.path).then(
        (s) => s.isFile(),
        () => false,
      ),
    })),
  )
}

export function installEngineDoorChannel(): void {
  ipcMain.handle("omni:engineDoors", (_e, cwd?: string) => engineDoors(cwd))
}
