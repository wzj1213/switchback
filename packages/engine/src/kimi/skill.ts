import type { SlashCommand } from "@switchback/protocol"
import { attachmentContent } from "./attach.js"
import type { KimiApi } from "./http.js"
import { sessionPath } from "./http.js"
import type { KimiSkill } from "./wire.js"

export interface KimiSkillInvocation {
  name: string
  args?: string
}

function activatable(skill: KimiSkill): boolean {
  return skill.type === undefined || skill.type === "prompt" || skill.type === "inline" || skill.type === "flow"
}

function scopeOf(source: string | undefined): SlashCommand["scope"] {
  if (source === "user") return "user"
  if (source === "workspace" || source === "project") return "project"
  if (source === "builtin" || source === "system") return "system"
  return undefined
}

function commandName(skill: KimiSkill): string {
  return skill.source === "builtin" || skill.source === "system" ? skill.name : `skill:${skill.name}`
}

function commandOrder(left: KimiSkill, right: KimiSkill): number {
  const leftGroup = left.source === "builtin" || left.source === "system" ? 0 : 1
  const rightGroup = right.source === "builtin" || right.source === "system" ? 0 : 1
  return leftGroup - rightGroup || left.name.localeCompare(right.name)
}

export function commandsOf(rows: readonly KimiSkill[]): readonly SlashCommand[] {
  return [...rows]
    .sort(commandOrder)
    .filter(activatable)
    .map((skill) => ({
      name: commandName(skill),
      description: skill.description ?? "",
      source: "engine" as const,
      ...(scopeOf(skill.source) === undefined ? {} : { scope: scopeOf(skill.source) }),
    }))
}

function parseInvocation(text: string): { command: string; args?: string } | undefined {
  if (!text.startsWith("/")) return undefined
  const raw = text.slice(1).trim()
  if (raw === "") return undefined
  const split = raw.search(/\s/)
  if (split < 0) return { command: raw }
  const args = raw.slice(split).trim()
  return { command: raw.slice(0, split), ...(args === "" ? {} : { args }) }
}

export function invocationOf(rows: readonly KimiSkill[], text: string): KimiSkillInvocation | undefined {
  const parsed = parseInvocation(text)
  if (parsed === undefined) return undefined
  const skill = rows.find((row) => activatable(row) && commandName(row) === parsed.command)
  return skill === undefined ? undefined : { name: skill.name, ...(parsed.args === undefined ? {} : { args: parsed.args }) }
}

export class KimiSkills {
  private rows: readonly KimiSkill[] | undefined

  constructor(
    private readonly api: KimiApi,
    private readonly sessionId: string,
  ) {}

  private async load(refresh: boolean): Promise<readonly KimiSkill[]> {
    if (!refresh && this.rows !== undefined) return this.rows
    const raw = await this.api.get<{ skills: readonly KimiSkill[] }>(sessionPath(this.sessionId, "/skills"))
    this.rows = raw.skills
    return raw.skills
  }

  async commands(): Promise<readonly SlashCommand[]> {
    return commandsOf(await this.load(true))
  }

  async resolve(text: string): Promise<KimiSkillInvocation | undefined> {
    if (!text.startsWith("/")) return undefined
    return invocationOf(await this.load(false), text)
  }

  async activate(invocation: KimiSkillInvocation, attachments?: readonly string[]): Promise<void> {
    const media = attachmentContent(attachments)
    const body = {
      ...(invocation.args === undefined ? {} : { args: invocation.args }),
      ...(media.length === 0 ? {} : { attachments: media }),
    }
    const tail = `/skills/${encodeURIComponent(invocation.name)}:activate`
    await this.api.post(sessionPath(this.sessionId, tail), body)
  }
}
