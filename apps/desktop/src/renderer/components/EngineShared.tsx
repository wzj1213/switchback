import { AcpConnect } from "./AcpConnect.js"
import { AcpEngines, useAcpPage } from "./AcpEngines.js"
import { AcpRegistry } from "./AcpRegistry.js"
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
  const acp = useAcpPage()
  return (
    <section className="eng-shared" aria-label="所有引擎共用">
      <Group
        title="安装与版本"
        hint="内置五家一次列全。只在你点下按钮后才会运行界面上写出的那条原生命令。"
        more="还没装的那几家给出装它要跑的命令——omni 确实知道来源的才给，不知道的就照实说不知道。第三方 ACP 引擎在下面几组。"
      >
        <EngineVersions onCopy={onCopy} />
      </Group>
      <Group
        title="已接入的 ACP 引擎"
        hint="写在 engines.json 里的那几家。「试接」只握手不开会话，顺带列出它自己报的登录方式。"
        more="升级、移除当场生效——正在被会话用着的那家，要等那些会话关掉。"
      >
        <AcpEngines engines={acp.engines} registry={acp.registry.data} onChanged={acp.changed} />
      </Group>
      <Group
        title="从 ACP 注册表接入"
        hint="ACP 官方注册表里各家自己登记的启动方式。点「接入」先把要执行、要下载的东西摆出来，确认了才装。"
        more="确认后装好（只有二进制要装）、握手试接、写进 engines.json，不用重启。打开这一页时，本机那份超过一小时才联网取一次。"
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
        title="手动接入"
        hint="注册表里没有的：指一个可执行文件，omni 发一次 ACP 的 initialize 试试，答得上来才让你接。"
        more="命令和参数由你给（各家进 ACP 模式的写法不同，看它自己的文档），omni 不猜。"
      >
        <AcpConnect onAdded={acp.changed} />
      </Group>
      <div className="eng-registry">
        <span>
          接好的都写在 <code>engines.json</code> 里，也可以自己拿编辑器改；改完点上面的「重新探测」，
          没有会话在用的那几家当场生效。
        </span>
        <button type="button" className="tbtn" onClick={onOpenEngines}>
          打开注册表
        </button>
      </div>
    </section>
  )
}
