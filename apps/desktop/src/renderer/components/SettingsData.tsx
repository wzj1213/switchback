import { Actions, Field, Group } from "./SettingsBits.js"
import { CopyIcon, RevealIcon } from "./icons.js"

/**
 * 「数据与排查」——**东西在哪儿、出问题了往哪儿看**。
 *
 * ## 为什么每一样都摆出路径
 *
 * 这一页是出问题时才来的。那时候人要的是「把那个文件给我」，
 * 而不是「omni 帮我判断一下」——所以每一行都是一个**能打开、能复制**的真实位置，
 * omni 自己一句结论都不下。
 *
 * 日志与引擎注册表原来只有菜单里有入口（`main/menu.ts`），而没人会为了找日志
 * 去翻菜单——**一个只在菜单里的东西，等于只有写它的人知道**。
 */
export function DataSection({
  dataDir,
  onReveal,
  onCopy,
  onDiagnose,
  onOpenEngines,
}: {
  dataDir: string
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onDiagnose: () => void
  onOpenEngines: () => void
}): React.JSX.Element {
  return (
    <>
      <Group title="东西都在哪儿" hint="omni 的全部本地数据都在这一个目录下；换机器时整份带走就行。">
        <PathRow label="数据目录" path={dataDir} hint="偏好、会话记录、审批规则、附件、日志，都在这儿" onReveal={onReveal} onCopy={onCopy} />
        <PathRow
          label="会话记录"
          path={`${dataDir}/threads`}
          hint="一条会话一个 .jsonl，追加式。重启之后历史还在，靠的就是它"
          onReveal={onReveal}
          onCopy={onCopy}
        />
        <PathRow
          label="运行日志"
          path={`${dataDir}/logs/omni.log`}
          hint="引擎起停、崩溃、写盘失败都记在这儿。不含对话内容"
          onReveal={onReveal}
          onCopy={onCopy}
        />
      </Group>
      <Group title="第三方引擎" hint="内置那几家在「引擎」页；这里是你自己往里加的那些。">
        <Field label="引擎注册表" hint={`${dataDir}/engines.json —— 一份十行的 JSON，用你自己的编辑器改比在这儿点开一个表单强。改完重启 omni 生效`} stack>
          <button type="button" className="tbtn" onClick={onOpenEngines}>
            用编辑器打开
          </button>
        </Field>
      </Group>
      <Group title="出问题了" hint="报问题时把这一份带上，比描述现象快得多。">
        <Field label="诊断报告" hint="版本、引擎探测结果、崩溃记录、日志尾部。不含会话内容">
          <button type="button" className="tbtn" onClick={onDiagnose}>
            导出…
          </button>
        </Field>
        <Actions>
          <span className="set__hint">导出后会在访达里选中那个文件。</span>
        </Actions>
      </Group>
    </>
  )
}

/** 一行「这是什么 · 在哪儿 · 两个动作」。三处一模一样，抽出来免得措辞各写一套。 */
function PathRow({ label, path, hint, onReveal, onCopy }: {
  label: string
  path: string
  hint: string
  onReveal: (path: string) => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  return (
    <Field
      label={label}
      hint={
        <>
          {hint}
          <br />
          <code className="set__path">{path}</code>
        </>
      }
      stack
    >
      <button
        type="button"
        className="tbtn"
        onClick={() => {
          onReveal(path)
        }}
      >
        <RevealIcon /> 在访达中显示
      </button>
      <button
        type="button"
        className="tbtn"
        onClick={() => {
          onCopy(path)
        }}
      >
        <CopyIcon /> 复制路径
      </button>
    </Field>
  )
}
