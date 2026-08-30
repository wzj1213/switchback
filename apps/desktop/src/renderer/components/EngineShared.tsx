import { EngineVersions } from "./EngineVersions.js"
import { Group } from "./SettingsBits.js"

/**
 * 所有引擎共用的那一块。
 *
 * ## 为什么单独存在
 *
 * 这里的两样东西**都不属于任何一家**：安装与版本是一张全量表（`engineVersions()`
 * 本来就一次返回所有家），`engines.json` 是一份注册表。它们原来长在
 * `EngineNative` 里，也就是长在**每一家的 tab 里面**——于是同一件事印了五份，
 * 而五份里没有一份看得到全貌。
 *
 * 判据是一句话：**这一项改的是「这一家」，还是「omni 认得哪几家」？**
 * 前者留在 tab 里（接入开关、新会话默认、模型/思考档、它自己的原生入口），
 * 后者到这儿来。
 *
 * ## 为什么放在 tab 下面而不是另开一页
 *
 * 它回答的仍然是「引擎」这一页的问题，而且**大多数时候你不看它**——
 * 一年装一次、几周升一次级。放上面会天天挡着那些真正要改的开关；
 * 另开一页则要求用户先知道它在哪儿。压在这一页的末尾正好：
 * 找得到，又不占路。
 */
export function EngineShared({
  onCopy,
  onOpenEngines,
}: {
  onCopy: (text: string) => void
  onOpenEngines: () => void
}): React.JSX.Element {
  return (
    <section className="eng-shared" aria-label="所有引擎共用">
      <Group
        title="安装与版本"
        hint="所有引擎一次列全。只在你点下按钮后才会运行界面写出的那条原生命令；还没装的那几家给出装它要跑的命令——omni 确实知道来源的才给，不知道的就照实说不知道。第三方 ACP 引擎的版本与安装由它自己管，不在这张表里。"
      >
        <EngineVersions onCopy={onCopy} />
      </Group>
      <div className="eng-registry">
        <span>
          第三方 ACP 引擎从 <code>engines.json</code> 接入。<b>改完这个文件要重启 omni</b>
          ——驱动表在启动时建一次，「重新探测」只重探已经认得的那几家，不重读这个文件。
        </span>
        <button type="button" className="tbtn" onClick={onOpenEngines}>
          打开注册表
        </button>
      </div>
    </section>
  )
}
