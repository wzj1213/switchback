import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import type { BuiltinEngineId } from "../shared/builtin-engines.js"
import { ENGINE_COPY } from "./engine-settings-copy.messages.js"

export interface EngineSettingsCopy {
  summary: string
  native?: {
    title: string
    command: string
    hint: string
  }
}

/** 去它自己那扇门的命令。命令是引擎的，不翻译；说明与标题在 `engine-settings-copy.messages.ts`。 */
const NATIVE_COMMAND: Readonly<Record<BuiltinEngineId, string>> = {
  claude: "claude auth",
  codex: "codex login",
  kimi: "kimi web",
  grok: "grok login",
  dsh: "dsh web",
}

function builtin(id: string): id is BuiltinEngineId {
  return Object.hasOwn(NATIVE_COMMAND, id)
}

export function settingsCopyOf(id: string, locale: Locale = DEFAULT_LOCALE): EngineSettingsCopy {
  const m = ENGINE_COPY[locale]
  if (!builtin(id)) return { summary: m.acp }
  return {
    summary: m.summary[id],
    native: { title: m.nativeTitle[id], command: NATIVE_COMMAND[id], hint: m.nativeHint[id] },
  }
}
