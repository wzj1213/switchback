import type { SlashCommand } from "@omni/protocol"

/**
 * omni 自己的斜杠命令。
 *
 * ## 收进来的标准：**这件事 omni 真的能做，而且不做成命令就得翻菜单**
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
export interface OmniAction {
  command: SlashCommand
  run: () => void
}

export function omniCommands(acts: {
  onNew: () => void
  onFork?: () => void
  onHandoff?: () => void
  onCompare?: () => void
  onEnv: () => void
  onExport: () => void
  onSettings: () => void
  onStop?: () => void
  onRename: () => void
}): readonly OmniAction[] {
  const list: (OmniAction | undefined)[] = [
    make("new", "在当前工作区新建一个会话", acts.onNew),
    make("rename", "给这个会话改个名字", acts.onRename),
    make("env", "看这个会话跑在什么环境里", acts.onEnv),
    make("export", "把整段对话复制成 Markdown", acts.onExport),
    // 下面这几条**没有对象就不给**：一个点了没反应的命令比没有这条命令更糟
    make("fork", "用另一家引擎另起一个会话跑同一件事", acts.onFork),
    make("handoff", "换一家引擎接着做这个会话", acts.onHandoff),
    make("compare", "和分叉出来的那个并排比一比", acts.onCompare),
    make("stop", "打断正在跑的这一轮", acts.onStop),
    make("settings", "打开设置", acts.onSettings),
  ]
  return list.filter((a): a is OmniAction => a !== undefined)
}

function make(name: string, description: string, run: (() => void) | undefined): OmniAction | undefined {
  return run === undefined ? undefined : { command: { name, description, source: "omni" }, run }
}
