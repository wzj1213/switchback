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
  // 「配置来源」自成一组，每份文件是卡片里的一行——上一版把它们画成一张张带框的小卡，
  // 塞在「原生配置」那张卡里，框里套框
  return (
    <>
      {copy.native === undefined ? null : (
        <Group
          title="原生配置"
          hint="认证、Provider 和厂商高级项走它公开的原生入口；常用的新会话偏好在上面直接改。"
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
                <CopyIcon /> 复制命令
              </button>
            </div>
          </Field>
        </Group>
      )}
      <Group title="配置来源" hint="这家引擎自己读的那几份配置。omni 只帮你打开，不替它改。">
        <EngineDoors engine={engine} cwd={cwd} dshProfile={dshProfile} onReveal={onReveal} />
      </Group>
    </>
  )
}
