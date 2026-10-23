import { defineMessages } from "@switchback/i18n"

/** 安装与版本里，一家还没装的引擎那一行。命令输出是原文，不翻译。 */
export const ENGINE_INSTALL = defineMessages(
  {
    noInstall: "Switchback 不代装这一家",
    copy: "复制命令",
    willRun: (command: string) => `将执行：${command}`,
    installing: "安装中…",
    install: "安装",
    done: (version: string) => `装好了：${version}。`,
    ready: "已就绪",
    running: "正在装，别关窗口…",
    failed: "没装成；下面是原文",
    notOnPath: "这一家在这台机器上不在 PATH 上",
    notInstalled: (where: string) => `还没装。${where}`,
    clickInstall: (tail: string) => `还没装。点「安装」会逐字执行右边那条命令，${tail}`,
    redetect: "装完 Switchback 会自己重新探测",
    requestFailed: (message: string) => `安装请求失败：${message}`,
  },
  {
    noInstall: "Switchback doesn't install this one",
    copy: "Copy command",
    willRun: (command) => `Will run: ${command}`,
    installing: "Installing…",
    install: "Install",
    done: (version) => `Installed: ${version}.`,
    ready: "ready",
    running: "Installing. Don't close the window…",
    failed: "Install failed; the output is below",
    notOnPath: "This engine isn't on PATH on this Mac",
    notInstalled: (where) => `Not installed. ${where}`,
    clickInstall: (tail) => `Not installed. “Install” runs the command on the right exactly as shown; ${tail}`,
    redetect: "Switchback detects it again afterward",
    requestFailed: (message) => `Install request failed: ${message}`,
  },
)
