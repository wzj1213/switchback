import { Field, Group } from "./SettingsBits.js"
import { CopyIcon, RevealIcon } from "./icons.js"

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
