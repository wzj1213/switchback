import { useEffect, useRef, useState } from "react"
import type { EngineId, SlashCommand } from "@switchback/protocol"
import { commandText } from "./slash.js"
import type { useAttachments } from "./useAttachments.js"
import { useEngineCommand } from "./use-engine-command.js"
import { composeDraft } from "./composer-blocks.js"
import type { DraftBlocks } from "./use-draft-blocks.js"

interface Options {
  prefill?: { text: string; attachments?: readonly string[]; at: number }
  engine: EngineId
  attach: ReturnType<typeof useAttachments>
  /** 输入框上方那排芯片。发送时展开进正文（见 `composer-blocks.ts`）。 */
  blocks: DraftBlocks
  blocked: boolean
  steering: boolean
  initial?: { text: string; command?: SlashCommand }
  onSend: (text: string, attachments: readonly string[], steer: boolean) => void
}

function usePrefill(
  prefill: Options["prefill"],
  restore: { attachments: (paths: readonly string[]) => void; blocks: () => void },
  setText: (text: string) => void,
  setCommand: (command: SlashCommand | undefined) => void,
): void {
  const seen = useRef(prefill?.at ?? 0)
  useEffect(() => {
    if (prefill === undefined || prefill.at === seen.current) return
    seen.current = prefill.at
    setCommand(undefined)
    restore.attachments(prefill.attachments ?? [])
    // **芯片一起清掉。** prefill 是「整份换成这一句」（改一改再发、从待发队列取回），
    // 而那一句里已经含着当时展开过的引用与粘贴——留着旧芯片会发第二遍
    restore.blocks()
    setText(prefill.text)
  }, [prefill, restore.attachments, restore.blocks, setCommand, setText])
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
  usePrefill(
    options.prefill,
    { attachments: options.attach.replace, blocks: options.blocks.clear },
    setText,
    setCommand,
  )
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
