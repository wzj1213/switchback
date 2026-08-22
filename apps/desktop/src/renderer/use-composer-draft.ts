import { useEffect, useRef, useState } from "react"
import type { EngineId, SlashCommand } from "@omni/protocol"
import { commandText } from "./slash.js"
import type { useAttachments } from "./useAttachments.js"
import { useEngineCommand } from "./use-engine-command.js"

interface Options {
  prefill?: { text: string; attachments?: readonly string[]; at: number }
  engine: EngineId
  attach: ReturnType<typeof useAttachments>
  blocked: boolean
  steering: boolean
  onSend: (text: string, attachments: readonly string[], steer: boolean) => void
}

function usePrefill(
  prefill: Options["prefill"],
  replaceAttachments: (paths: readonly string[]) => void,
  setText: (text: string) => void,
  setCommand: (command: SlashCommand | undefined) => void,
): void {
  const seen = useRef(prefill?.at ?? 0)
  useEffect(() => {
    if (prefill === undefined || prefill.at === seen.current) return
    seen.current = prefill.at
    setCommand(undefined)
    replaceAttachments(prefill.attachments ?? [])
    setText(prefill.text)
  }, [prefill, replaceAttachments, setCommand, setText])
}

export function useComposerDraft(options: Options): {
  text: string
  setText: React.Dispatch<React.SetStateAction<string>>
  command: SlashCommand | undefined
  setCommand: React.Dispatch<React.SetStateAction<SlashCommand | undefined>>
  submit: (steer?: boolean) => void
} {
  const [text, setText] = useState("")
  const [command, setCommand] = useState<SlashCommand>()
  usePrefill(options.prefill, options.attach.replace, setText, setCommand)
  useEngineCommand(options.engine, command, setCommand, setText)

  const submit = (steer = false): void => {
    const prompt = commandText(command, text)
    if ((prompt === "" && options.attach.paths.length === 0) || options.blocked) return
    options.onSend(prompt, options.attach.paths, steer && options.steering)
    setText("")
    setCommand(undefined)
    options.attach.clear()
  }

  return { text, setText, command, setCommand, submit }
}
