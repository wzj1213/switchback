import type { SlashCommand } from "@switchback/protocol"

/**
 * Switchback 自己的斜杠命令。
 *
 * ## 收进来的标准：**这件事 Switchback 真的能做，而且不做成命令就得翻菜单**
 *
 * 所以这里只有已经存在的功能，一条新能力都没造。做成命令的价值是
 * 「手不离键盘」——它们本来都藏在右键菜单、顶栏图标或 `⌘` 组合键后面，
 * 而那三处各有各的记忆成本。
 *
 * ## 没收进来的
 *
 * - **删除会话**：不可撤销的事不放进一个「打两个字母就中」的入口。
 *   它在行内 `···` 里，还有二次确认，那是它该待的地方。
 * - **改模型 / 改信任档**：输入区里已经有两个下拉，就在手边，
 *   再复制一份到命令面板只会有两处状态要同步。
 */
export interface SwitchbackAction {
  command: SlashCommand
  run: () => void
}

export function switchbackCommands(acts: {
  onNew: () => void
  onFork?: () => void
  onHandoff?: () => void
  onCompare?: () => void
  onEnv: () => void
  onTimeline: () => void
  onExport: () => void
  onSettings: () => void
  onStop?: () => void
  onRename: () => void
  onCompact?: () => void
  /** 承接上一段：把上一家引擎那份原始记录的路径填进输入框。没有可承接的就不给。 */
  onPickup?: { run: () => void; from: string }
}): readonly SwitchbackAction[] {
  const list: (SwitchbackAction | undefined)[] = [
    make("new", "新建会话", "在当前工作区另开一个", acts.onNew),
    make("rename", "重命名", "给这个会话改个名字", acts.onRename),
    make("env", "环境信息", "看这个会话跑在什么环境里", acts.onEnv),
    make("timeline", "引擎时间线", "这条会话都被哪几家引擎跑过、记录在哪", acts.onTimeline),
    make("export", "导出对话", "整段复制成 Markdown", acts.onExport),
    // 下面这几条**没有对象就不给**：一个点了没反应的命令比没有这条命令更糟
    make("fork", "分叉", "用另一家引擎另开一条同工作区分支", acts.onFork),
    make("handoff", "接力", "换一家引擎接着做这个会话", acts.onHandoff),
    // 名字里带上是谁：这条命令的全部价值就在「承接的是哪一段」，
    // 写成干巴巴的「承接上一段」的话，一条会话切过三家之后你不知道拿到的是谁那份
    make(
      "pickup",
      "承接上一段",
      acts.onPickup === undefined
        ? ""
        : `把 ${acts.onPickup.from} 那份原始记录的路径填进输入框，让新的一家自己去读`,
      acts.onPickup?.run,
    ),
    make("compare", "对比", "和分叉出来的那个并排比一比", acts.onCompare),
    make("stop", "停止", "打断正在跑的这一轮", acts.onStop),
    make("compact", "压缩上下文", "让引擎把前面的对话总结掉，腾出窗口继续", acts.onCompact),
    make("settings", "设置", "打开设置", acts.onSettings),
  ]
  return list.filter((a): a is SwitchbackAction => a !== undefined)
}

function make(
  name: string,
  label: string,
  description: string,
  run: (() => void) | undefined,
): SwitchbackAction | undefined {
  return run === undefined ? undefined : { command: { name, label, description, source: "switchback" }, run }
}
