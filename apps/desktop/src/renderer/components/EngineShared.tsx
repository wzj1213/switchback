import { AcpConnect } from "./AcpConnect.js"
import { AcpEngines, useAcpPage } from "./AcpEngines.js"
import { AcpRegistry } from "./AcpRegistry.js"
import { EngineVersions } from "./EngineVersions.js"
import { Group } from "./SettingsBits.js"
import { useMessages } from "../i18n.js"
import { ENGINE_SHARED } from "./EngineShared.messages.js"

/**
 * 所有引擎共用的那一块。
 *
 * ## 为什么单独存在
 *
 * 这里的三样东西**都不属于任何一家**：安装与版本是一张全量表
 *（`engineVersions()` 本来就一次返回所有家）、接一家新的、`engines.json` 注册表。
 * 前两样原来长在 `EngineNative` 里，也就是长在**每一家的 tab 里面**——
 * 于是同一件事印了五份，而五份里没有一份看得到全貌。
 *
 * 判据是一句话：**这一项改的是「这一家」，还是「Switchback 认得哪几家」？**
 * 前者留在引擎页（接入开关、新会话默认、模型/思考档、它自己的原生入口），
 * 后者到这儿来。
 *
 * ## 为什么最后独立成一页
 *
 * 上一版它压在引擎页的末尾，理由是「找得到，又不占路」。那条理由不成立：
 *
 * 1. **引擎页上沿那条 tab 条是 sticky 的**，它在视觉上宣告了「下面这些属于
 *    选中的那一家」。把一块不归它管的东西放进那个作用域，等于把
 *    「散落在五个 tab 里」改成「藏在一个 tab 底下」——问题只搬了个家。
 *    它当时还得靠一条实线把自己和上面断开，那本身就是位置不对的信号。
 * 2. **它要 spawn 一串子进程**（`codex --version`、`npm view`）。分页的初衷
 *    正是「没点到的那一页根本不挂载」（见 `SettingsPanel` 开头），而挂在引擎页上
 *    等于每次进去改个默认模型都白付一次——那才是引擎页真正的日常用途。
 *
 * 代价是要多走一步，所以引擎页底下留了一条过去的路：一个人是先想到
 * 「我要用 codex」才想到「哦它没装」的，而那一刻他人在那一页。
 */
export function EngineShared({
  onCopy,
  onOpenEngines,
}: {
  onCopy: (text: string) => void
  onOpenEngines: () => void
}): React.JSX.Element {
  const acp = useAcpPage()
  const m = useMessages(ENGINE_SHARED)
  return (
    <section className="eng-shared" aria-label={m.label}>
      <Group
        title={m.versions}
        hint={m.versionsHint}
        more={m.versionsMore}
      >
        <EngineVersions onCopy={onCopy} />
      </Group>
      <Group
        title={m.acp}
        hint={m.acpHint}
        more={m.acpMore}
      >
        <AcpEngines engines={acp.engines} registry={acp.registry.data} onChanged={acp.changed} />
      </Group>
      <Group
        title={m.registry}
        hint={m.registryHint}
        more={m.registryMore}
      >
        <AcpRegistry
          view={acp.registry.data}
          loading={acp.registry.loading}
          failed={acp.registry.failed}
          onRefresh={acp.registry.refresh}
          onChanged={acp.changed}
        />
      </Group>
      <Group
        title={m.manual}
        hint={m.manualHint}
        more={m.manualMore}
      >
        <AcpConnect onAdded={acp.changed} />
      </Group>
      <div className="eng-registry">
        <span>
          {m.footBefore}<code>engines.json</code>{m.footAfter}
        </span>
        <button type="button" className="tbtn" onClick={onOpenEngines}>
          {m.openRegistry}
        </button>
      </div>
    </section>
  )
}
