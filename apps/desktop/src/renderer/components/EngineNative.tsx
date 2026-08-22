import { EngineDoors } from "./EngineDoors.js"
import { EngineVersions } from "./EngineVersions.js"
import { Field, Group } from "./SettingsBits.js"
import { CopyIcon } from "./icons.js"
import type { EngineSettingsCopy } from "../engine-settings-copy.js"

export function EngineNative({
  engine,
  copy,
  cwd,
  onCopy,
  onOpenEngines,
  onReveal,
}: {
  engine: string
  copy: EngineSettingsCopy
  cwd: string | undefined
  onCopy: (text: string) => void
  onOpenEngines: () => void
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
          <EngineDoors engine={engine} cwd={cwd} onReveal={onReveal} />
        </div>
      </Group>
      <Group title="版本与更新" hint="只在你点下更新后才会运行界面写出的那条原生命令。">
        <EngineVersions engine={engine} />
      </Group>
      <div className="eng-registry">
        <span>
          第三方 ACP 引擎仍从 <code>engines.json</code> 接入；改完后重启 omni。
        </span>
        <button type="button" className="tbtn" onClick={onOpenEngines}>
          打开注册表
        </button>
      </div>
    </>
  )
}
