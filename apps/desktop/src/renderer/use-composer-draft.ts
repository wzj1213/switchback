import { useEffect, useRef, useState } from "react"
import type { EngineId, SlashCommand } from "@switchback/protocol"
import { commandText } from "./slash.js"
import type { useAttachments } from "./useAttachments.js"
import { useEngineCommand } from "./use-engine-command.js"
import { composeDraft } from "./composer-blocks.js"
import type { DraftBlocks } from "./use-draft-blocks.js"

interface Options {
  prefill?: { text: string; attachments?: readonly string[]; at: number; lead?: boolean }
  engine: EngineId
  attach: ReturnType<typeof useAttachments>
  /** 输入框上方那排芯片。发送时展开进正文（见 `composer-blocks.ts`）。 */
  blocks: DraftBlocks
  blocked: boolean
  steering: boolean
  initial?: { text: string; command?: SlashCommand }
  onSend: (text: string, attachments: readonly string[], steer: boolean) => void
}

/**
 * 一段话并进输入框里已有的正文。空着就是它本身；`lead` 放在前面（「问一句」的引文），否则另起一行接在后面。
 */
export function mergeDraft(current: string, incoming: string, lead: boolean): string {
  if (incoming === "") return current
  if (current.trim() === "") return incoming
  return lead ? `${incoming}${current}` : `${current.replace(/\s+$/, "")}\n${incoming}`
}

/**
 * **并进来，不整份换掉。** 取回、接回失败退回、改一改再发、问一句，都可能撞上输入框里
 * 正写着的东西。上一版整份换掉：正文、命令、芯片当场没了，换下来的图还被当成没人要的文件删掉。
 * 现在正文接上、附件取并集、芯片和命令原样留着——已经在输入框里的东西一样都不丢。
 */
function usePrefill(
  prefill: Options["prefill"],
  include: (paths: readonly string[]) => void,
  setText: React.Dispatch<React.SetStateAction<string>>,
): void {
  const seen = useRef(prefill?.at ?? 0)
  useEffect(() => {
    if (prefill === undefined || prefill.at === seen.current) return
    seen.current = prefill.at
    include(prefill.attachments ?? [])
    setText((current) => mergeDraft(current, prefill.text, prefill.lead === true))
  }, [prefill, include, setText])
}

export function useComposerDraft(options: Options): {
  text: string
  setText: React.Dispatch<React.SetStateAction<string>>
  command: SlashCommand | undefined
  setCommand: React.Dispatch<React.SetStateAction<SlashCommand | undefined>>
  submit: (steer?: boolean) => void
} {
  const [text, setText] = useState(options.initial?.text ?? "")
  const [command, setCommand] = useState<SlashCommand | undefined>(options.initial?.command)
  usePrefill(options.prefill, options.attach.include, setText)
  useEngineCommand(options.engine, command, setCommand, setText)

  const submit = (steer = false): void => {
    // 芯片在这一刻展开成正文。**转录区里看到的就是这一段**——
    // 输入框折起来的只是显示，发出去的字一个都没少（见 `composer-blocks.ts`）
    const prompt = composeDraft(commandText(command, text), options.blocks.blocks)
    if ((prompt === "" && options.attach.paths.length === 0) || options.blocked) return
    options.onSend(prompt, options.attach.paths, steer && options.steering)
    setText("")
    setCommand(undefined)
    options.attach.clear()
    options.blocks.clear()
  }

  return { text, setText, command, setCommand, submit }
}
