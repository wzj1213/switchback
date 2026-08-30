import { AcpConnect } from "./AcpConnect.js"
import { EngineVersions } from "./EngineVersions.js"
import { Group } from "./SettingsBits.js"

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
 * 判据是一句话：**这一项改的是「这一家」，还是「omni 认得哪几家」？**
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
  return (
    <section className="eng-shared" aria-label="所有引擎共用">
      <Group
        title="安装与版本"
        hint="所有引擎一次列全。只在你点下按钮后才会运行界面写出的那条原生命令；还没装的那几家给出装它要跑的命令——omni 确实知道来源的才给，不知道的就照实说不知道。第三方 ACP 引擎的版本与安装由它自己管，不在这张表里。"
      >
        <EngineVersions onCopy={onCopy} />
      </Group>
      <Group
        title="接一家新的"
        hint="omni 还不认识的 ACP 引擎：指一个可执行文件，omni 发一次 ACP 的 initialize 试试——答得上来才让你接。命令和参数由你给（各家进 ACP 模式的写法不同，看它自己的文档），omni 不猜、也不内置一张迟早会过期的表。"
      >
        <AcpConnect />
      </Group>
      <div className="eng-registry">
        <span>
          接好的会写进 <code>engines.json</code>，也可以自己拿编辑器改。
          <b>新加一家点上面的「重新探测」就能用</b>；改已有那家的配置、或者把它删掉，
          要重启 omni 才生效——正在跑的会话还握着旧的那份。
        </span>
        <button type="button" className="tbtn" onClick={onOpenEngines}>
          打开注册表
        </button>
      </div>
    </section>
  )
}
