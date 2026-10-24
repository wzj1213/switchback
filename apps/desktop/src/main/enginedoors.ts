import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { ipcMain, shell } from "electron"
import { homeOf } from "./envengines.js"
import { BUILTIN_ENGINE_LABELS } from "../shared/builtin-engines.js"
import { isDshProfileName } from "../shared/settings.js"
import { installDshProfileChannel } from "./dsh-profiles.js"
import type { Channels } from "./channels.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { ENGINE_DOORS } from "./enginedoors.messages.js"

type Text = (typeof ENGINE_DOORS)[Locale]

/**
 * **各家引擎自己的设置在哪儿。**
 *
 * ## Switchback 在这件事上只做一件事：把门指出来
 *
 * 不解析、不改写、不在 Switchback 里再造一套表单。理由写在 `AGENTS.md` 的产品边界总纲里：
 * Switchback 与引擎是共建者，不是上下级。它们各自的配置格式、默认值、生效时机都是它们的事，
 * Switchback 抄一份进来就得跟着它们改——而厂商改的时候不会通知我们，
 * 于是界面上摆着一份**过期的、看起来还能用的**设置。
 *
 * 反过来，「配置在哪儿」这件事 Switchback 是知道的（它本来就要读这些文件算钩子），
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

function dshDoors(profile: string, m: Text): readonly Door[] {
  const home = homeOf("DSH_HOME", ".dsh")
  return [
    {
      id: "dsh",
      label: BUILTIN_ENGINE_LABELS.dsh,
      scope: "user",
      path: join(home, "settings.yaml"),
      note: m.dshSettings,
    },
    {
      id: "dsh",
      label: BUILTIN_ENGINE_LABELS.dsh,
      scope: "user",
      path: join(home, "profiles", profile, "cordis.patch.yml"),
      note: m.dshProfile(profile),
    },
  ]
}

/** 各家的配置文件在哪。**家目录认各自的环境变量**，改过家目录的人正是最需要这一页的。 */
function layout(cwd: string | undefined, dshProfile: string, m: Text): readonly Door[] {
  const project = (rest: string): readonly string[] => (cwd === undefined ? [] : [join(cwd, rest)])
  const rows: Door[] = [
    {
      id: "antigravity",
      label: BUILTIN_ENGINE_LABELS.antigravity,
      scope: "user",
      path: join(homedir(), ".gemini", "antigravity-cli", "settings.json"),
      note: m.antigravity,
    },
    {
      id: "claude",
      label: BUILTIN_ENGINE_LABELS.claude,
      scope: "user",
      path: join(homedir(), ".claude", "settings.json"),
      note: m.claude,
    },
    {
      id: "codex",
      label: BUILTIN_ENGINE_LABELS.codex,
      scope: "user",
      path: join(homeOf("CODEX_HOME", ".codex"), "config.toml"),
      note: m.codex,
    },
    {
      id: "kimi",
      label: BUILTIN_ENGINE_LABELS.kimi,
      scope: "user",
      path: join(homeOf("KIMI_CODE_HOME", ".kimi-code"), "config.toml"),
      note: m.kimi,
    },
    {
      id: "grok",
      label: BUILTIN_ENGINE_LABELS.grok,
      scope: "managed",
      path: join(homeOf("GROK_HOME", ".grok"), "managed_config.toml"),
      note: m.grokManaged,
    },
    {
      id: "grok",
      label: BUILTIN_ENGINE_LABELS.grok,
      scope: "user",
      path: join(homeOf("GROK_HOME", ".grok"), "config.toml"),
      note: m.grokUser,
    },
    ...dshDoors(dshProfile, m),
  ]
  for (const [id, label, rest] of [
    ["claude", BUILTIN_ENGINE_LABELS.claude, join(".claude", "settings.json")],
    ["codex", BUILTIN_ENGINE_LABELS.codex, join(".codex", "config.toml")],
    ["grok", BUILTIN_ENGINE_LABELS.grok, join(".grok", "config.toml")],
  ] as const) {
    for (const path of project(rest)) rows.push({ id, label, scope: "project", path, note: m.project })
  }
  return rows
}

/** 读一遍盘看哪几份真的在。**读不到当不存在**——这一页不该因为权限问题整个空掉。 */
export async function engineDoors(
  cwd: string | undefined,
  dshProfile = "acp",
  locale: Locale = DEFAULT_LOCALE,
): Promise<readonly EngineDoor[]> {
  const profile = isDshProfileName(dshProfile) ? dshProfile : "acp"
  return Promise.all(
    layout(cwd, profile, ENGINE_DOORS[locale]).map(async (row) => ({
      ...row,
      exists: await stat(row.path).then(
        (s) => s.isFile(),
        () => false,
      ),
    })),
  )
}

/** 系统编辑器只接现有、非厂商维护的来源。 */
export function editableEngineDoorPaths(doors: readonly EngineDoor[]): readonly string[] {
  return doors.filter((door) => door.exists && door.scope !== "managed").map((door) => door.path)
}

/** 参数逐个核：远程模式下这一条也能被另一台电脑调（`remote/exposure.ts`）。 */
function doorRequestOf(value: unknown): { cwd?: string; dshProfile?: string } {
  if (typeof value !== "object" || value === null) return {}
  const { cwd, dshProfile } = value as { cwd?: unknown; dshProfile?: unknown }
  return { ...(typeof cwd === "string" ? { cwd } : {}), ...(typeof dshProfile === "string" ? { dshProfile } : {}) }
}

export function installEngineDoorChannel(channels: Channels, locale: () => Locale = () => DEFAULT_LOCALE): void {
  // 只允许打开刚发给设置页、并且确实存在的那几份。渲染层拿不到通用文件打开口子。
  const shown = new Set<string>()
  channels.handle("switchback:engineDoors", async (value: unknown) => {
    const req = doorRequestOf(value)
    const doors = await engineDoors(req.cwd, req.dshProfile, locale())
    shown.clear()
    for (const path of editableEngineDoorPaths(doors)) shown.add(path)
    return doors
  })
  ipcMain.on("switchback:openEngineFile", (_e, path: string) => {
    if (shown.has(path)) void shell.openPath(path)
  })
}

export function installEngineDoorChannels(channels: Channels, locale: () => Locale = () => DEFAULT_LOCALE): void {
  installEngineDoorChannel(channels, locale)
  installDshProfileChannel(channels)
}
