import { defineMessages } from "@switchback/i18n"

/** 安装、更新跑完之后接在原文后面的那几句。安装器、包管理器的输出原样在前面。 */
export const ENGINE_VERSION = defineMessages(
  {
    noInstaller: (engine: string) => `Switchback 不知道 ${engine} 的安装来源，这一家要按它自己的方式装`,
    installQuiet: "安装器正常结束，没有额外输出。",
    installSilent: "安装命令没有输出。",
    installMissing: "Switchback 复查：装完之后仍然探不到这个命令。可能装在了不在 PATH 上的位置。",
    noUpdater: (engine: string) => `${engine} 当前没有可由 Switchback 执行的更新入口`,
    updateQuiet: "更新器正常结束，没有额外输出。",
    updateSilent: "更新命令没有输出。",
    recheck: (before: string, after: string) => `Switchback 复查版本：${before} → ${after}`,
  },
  {
    noInstaller: (engine) => `Switchback doesn't know where ${engine} is installed from, so install it the way its own docs say`,
    installQuiet: "The installer finished normally with no extra output.",
    installSilent: "The install command printed nothing.",
    installMissing: "Switchback checked again: the command still can't be found after installing. It may have been installed somewhere that isn't on PATH.",
    noUpdater: (engine) => `${engine} has no update entry point that Switchback can run right now`,
    updateQuiet: "The updater finished normally with no extra output.",
    updateSilent: "The update command printed nothing.",
    recheck: (before, after) => `Switchback checked the version again: ${before} → ${after}`,
  },
)
