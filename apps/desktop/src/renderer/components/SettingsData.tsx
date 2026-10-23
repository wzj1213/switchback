import { Field, Group } from "./SettingsBits.js"
import { CopyIcon, RevealIcon } from "./icons.js"
import { useMessages } from "../i18n.js"
import { SETTINGS_DATA } from "./SettingsData.messages.js"

/**
 * 「数据与排查」——**东西在哪儿、出问题了往哪儿看**。
 *
 * ## 为什么每一样都摆出路径
 *
 * 这一页是出问题时才来的。那时候人要的是「把那个文件给我」，
 * 而不是「Switchback 帮我判断一下」——所以每一行都是一个**能打开、能复制**的真实位置，
 * Switchback 自己一句结论都不下。
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
  const m = useMessages(SETTINGS_DATA)
  return (
    <>
      <Group title={m.where} hint={m.whereHint}>
        <PathRow label={m.dataDir} path={dataDir} hint={m.dataDirHint} onReveal={onReveal} onCopy={onCopy} />
        <PathRow
          label={m.threads}
          path={`${dataDir}/threads`}
          shown={m.threadsShown}
          hint={m.threadsHint}
          onReveal={onReveal}
          onCopy={onCopy}
        />
        <PathRow
          label={m.log}
          path={`${dataDir}/logs/switchback.log`}
          shown={m.logShown}
          hint={m.logHint}
          onReveal={onReveal}
          onCopy={onCopy}
        />
      </Group>
      <Group title={m.thirdParty} hint={m.thirdPartyHint}>
        <Field
          label={m.registry}
          hint={
            <>
              {m.registryHint}
              <br />
              <code className="set__path" title={`${dataDir}/engines.json`}>{m.registryShown}</code>
            </>
          }
        >
          <button type="button" className="tbtn" onClick={onOpenEngines}>
            {m.openEditor}
          </button>
        </Field>
      </Group>
      <Group title={m.trouble} hint={m.troubleHint}>
        <Field label={m.diagnose} hint={m.diagnoseHint}>
          <button type="button" className="tbtn" onClick={onDiagnose}>
            {m.export}
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
  const m = useMessages(SETTINGS_DATA)
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
        aria-label={m.revealOf(label)}
        data-tip={m.reveal}
        onClick={() => {
          onReveal(path)
        }}
      >
        <RevealIcon />
      </button>
      <button
        type="button"
        className="iconbtn"
        aria-label={m.copyOf(label)}
        data-tip={m.copy}
        onClick={() => {
          onCopy(path)
        }}
      >
        <CopyIcon />
      </button>
    </Field>
  )
}
