import { EngineVersions } from "./EngineVersions.js"
import { Field, Group } from "./SettingsBits.js"
import { CopyIcon, RevealIcon } from "./icons.js"

/**
 * 「引擎」与「数据与排查」两页。
 *
 * 这里的每一项都只是**链接过去的入口**：引擎注册表、诊断报告在菜单里已经有实现，
 * 这里不复制第二份。摆两份实现的下场是其中一份迟早不更新，而那份正好是用户用的那份。
 */

export function EnginesSection({ onOpenEngines }: { onOpenEngines: () => void }): React.JSX.Element {
  return (
    <>
      {/* 两张卡，不是一张：版本那张底下带一颗「重新检查」，
          而注册表和「装的哪版」不是一回事——挤在一张卡里，那颗按钮看起来像在管注册表 */}
      <Group title="引擎版本" hint="更新会动你的全局环境（一条 npm i -g），所以只做到「把命令摆出来，你自己点」。">
        <EngineVersions />
      </Group>
      <Group title="引擎注册表">
        <Field label="engines.json" hint="挂第三方 ACP 引擎，改完要重启 omni">
          <button type="button" className="tbtn" onClick={onOpenEngines}>
            打开
          </button>
        </Field>
      </Group>
    </>
  )
}

export function DataSection({
  dataDir,
  onReveal,
  onCopy,
  onDiagnose,
}: {
  dataDir: string
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onDiagnose: () => void
}): React.JSX.Element {
  return (
    <Group title="数据与排查">
      <Field label="数据目录" hint={dataDir}>
        <button
          type="button"
          className="tbtn"
          onClick={() => {
            onReveal(dataDir)
          }}
        >
          <RevealIcon /> 在访达中显示
        </button>
        <button
          type="button"
          className="tbtn"
          onClick={() => {
            onCopy(dataDir)
          }}
        >
          <CopyIcon /> 复制路径
        </button>
      </Field>
      <Field label="诊断报告" hint="版本、引擎探测、崩溃记录、日志尾部。不含会话内容">
        <button type="button" className="tbtn" onClick={onDiagnose}>
          导出…
        </button>
      </Field>
    </Group>
  )
}
