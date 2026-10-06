import { useEffect, useRef } from "react"
import type { EngineId, SlashCommand } from "@switchback/protocol"
import { applyCommand } from "./slash.js"

/** 换引擎时旧 token 不再冒充仍然有效；退回可编辑原文，同时不丢参数。 */
export function useEngineCommand(
  engine: EngineId,
  command: SlashCommand | undefined,
  setCommand: (command: SlashCommand | undefined) => void,
  setText: React.Dispatch<React.SetStateAction<string>>,
): void {
  const seen = useRef(engine)
  useEffect(() => {
    if (seen.current === engine) return
    seen.current = engine
    if (command === undefined) return
    setText((args) => `${applyCommand(command).text}${args}`)
    setCommand(undefined)
  }, [command, engine, setCommand, setText])
}
