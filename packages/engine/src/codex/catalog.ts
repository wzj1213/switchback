import type { SlashCommand } from "@omni/protocol"
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
  const text = short ?? skill.description ?? ""
  return {
    name: skill.name,
    // displayName 是中文的时候，把它放在说明最前面——列表里一眼能认出来
    description: display === undefined || display === skill.name ? text : `${display} · ${text}`,
    source: "engine",
  }
}
