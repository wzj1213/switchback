import { EngineDoors } from "./EngineDoors.js"
import { Field, Group } from "./SettingsBits.js"
import { CopyIcon } from "./icons.js"
import type { EngineSettingsCopy } from "../engine-settings-copy.js"

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
  return (
    <>
      <Group
        title="原生配置"
        hint="常用的新会话偏好在上面直接改；认证、Provider 和厂商高级项仍走它公开的原生入口。"
      >
        {copy.native === undefined ? null : (
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
                <CopyIcon /> 复制命令
              </button>
            </div>
          </Field>
        )}
        <div className="eng-sources">
          <div className="eng-sources__title">配置来源</div>
          <EngineDoors engine={engine} cwd={cwd} dshProfile={dshProfile} onReveal={onReveal} />
        </div>
      </Group>
    </>
  )
}
