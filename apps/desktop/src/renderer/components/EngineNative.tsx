import { EngineDoors } from "./EngineDoors.js"
import { Field, Group } from "./SettingsBits.js"
import { CopyIcon } from "./icons.js"
import type { EngineSettingsCopy } from "../engine-settings-copy.js"
import { useMessages } from "../i18n.js"
import { ENGINE_NATIVE } from "./EngineNative.messages.js"

export function EngineNative({
  engine,
  dshProfile,
  copy,
  cwd,
  onCopy,
  onReveal,
}: {
  engine: string
  dshProfile?: string
  copy: EngineSettingsCopy
  cwd: string | undefined
  onCopy: (text: string) => void
  onReveal: (path: string) => void
}): React.JSX.Element {
  // 「配置来源」自成一组，每份文件是卡片里的一行——上一版把它们画成一张张带框的小卡，
  // 塞在「原生配置」那张卡里，框里套框
  const m = useMessages(ENGINE_NATIVE)
  return (
    <>
      {copy.native === undefined ? null : (
        <Group
          title={m.native}
          hint={m.nativeHint}
        >
          <Field label={copy.native.title} hint={copy.native.hint} stack>
            <div className="eng-command">
              <code>{copy.native.command}</code>
              <button
                type="button"
                className="tbtn"
                onClick={() => {
                  onCopy(copy.native?.command ?? "")
                }}
              >
                <CopyIcon /> {m.copy}
              </button>
            </div>
          </Field>
        </Group>
      )}
      <Group title={m.sources} hint={m.sourcesHint}>
        <EngineDoors engine={engine} cwd={cwd} dshProfile={dshProfile} onReveal={onReveal} />
      </Group>
    </>
  )
}
