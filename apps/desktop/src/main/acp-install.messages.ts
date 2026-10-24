import { defineMessages } from "@switchback/i18n"

/** 下载、校验、解包二进制时可能出的岔子。校验值、路径、解包器的输出原样显示。 */
export const ACP_INSTALL = defineMessages(
  {
    downloadFailed: (status: number) => `下载失败：HTTP ${String(status)}`,
    checksum: (expected: string, got: string) => `校验没过：注册表写的 sha256 是 ${expected}，下载到的是 ${got}。没有解包。`,
    outside: "可执行文件的路径不在安装目录里",
    extractFailed: (output: string) => `解包失败：${output}`,
    registryOutside: "注册表给的可执行文件路径不在安装目录里，没有安装。",
    missingCmd: (cmd: string) => `解包后没找到注册表说的 ${cmd}。`,
    cancelled: "已取消。",
  },
  {
    downloadFailed: (status) => `Download failed: HTTP ${String(status)}`,
    checksum: (expected, got) => `Checksum mismatch: the registry lists sha256 ${expected}, but the download is ${got}. Nothing was unpacked.`,
    outside: "The executable's path is outside the install folder",
    extractFailed: (output) => `Unpacking failed: ${output}`,
    registryOutside: "The executable path from the registry is outside the install folder, so nothing was installed.",
    missingCmd: (cmd) => `After unpacking, ${cmd} (as named by the registry) wasn't there.`,
    cancelled: "Cancelled.",
  },
)
