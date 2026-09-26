import { Field, Group } from "./SettingsBits.js"
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
          shown="数据目录/threads"
          hint="一条会话一个 .jsonl，追加式。重启之后历史还在，靠的就是它"
          onReveal={onReveal}
          onCopy={onCopy}
        />
        <PathRow
          label="运行日志"
          path={`${dataDir}/logs/omni.log`}
          shown="数据目录/logs/omni.log"
          hint="引擎起停、崩溃、写盘失败都记在这儿。不含对话内容"
          onReveal={onReveal}
          onCopy={onCopy}
        />
      </Group>
      <Group title="第三方引擎" hint="内置那几家在「引擎」页；这里是你自己往里加的那些。">
        <Field
          label="引擎注册表"
          hint={
            <>
              一份十行的 JSON，用你自己的编辑器改；存盘后到「安装与接入」点「重新探测」就生效
              <br />
              <code className="set__path" title={`${dataDir}/engines.json`}>数据目录/engines.json</code>
            </>
          }
        >
          <button type="button" className="tbtn" onClick={onOpenEngines}>
            用编辑器打开
          </button>
        </Field>
      </Group>
      <Group title="出问题了" hint="报问题时把这一份带上，比描述现象快得多。">
        <Field label="诊断报告" hint="版本、引擎探测结果、崩溃记录、日志尾部，不含会话内容。导出后会在访达里选中它">
          <button type="button" className="tbtn" onClick={onDiagnose}>
            导出…
          </button>
        </Field>
      </Group>
    </>
  )
}

/** 一行「这是什么 · 在哪儿 · 两个动作」。三处一模一样，抽出来免得措辞各写一套。 */
/**
 * 一条路径：名字、一句说明、路径本身，右边两颗图标键。
 *
 * 上一版每条都是「说明 + 整条路径 + 两颗带字的大按钮」竖着叠，三条路径就占满一屏，
 * 而数据目录那一长串前缀在三行里重复了三遍。子路径现在只写「数据目录/threads」，
 * 完整路径在悬停提示里、复制出去的也是完整路径——**读的时候省眼，拿的时候不缺字**。
 */
function PathRow({ label, path, shown, hint, onReveal, onCopy }: {
  label: string
  path: string
  /** 行里显示成什么。缺省就是完整路径。 */
  shown?: string
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
          <code className="set__path" title={path}>{shown ?? path}</code>
        </>
      }
    >
      <button
        type="button"
        className="iconbtn"
        aria-label={`在访达中显示${label}`}
        data-tip="在访达中显示"
        onClick={() => {
          onReveal(path)
        }}
      >
        <RevealIcon />
      </button>
      <button
        type="button"
        className="iconbtn"
        aria-label={`复制${label}的路径`}
        data-tip="复制完整路径"
        onClick={() => {
          onCopy(path)
        }}
      >
        <CopyIcon />
      </button>
    </Field>
  )
}
