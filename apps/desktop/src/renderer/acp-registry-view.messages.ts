import { defineMessages } from "@switchback/i18n"

/** ACP 注册表那一页的年龄与「接入会做什么」。命令、包名、校验值是原文。 */
export const ACP_VIEW = defineMessages(
  {
    never: "还没取到过",
    justNow: "刚刚取的",
    minutesAgo: (n: number) => `${String(n)} 分钟前取的`,
    hoursAgo: (n: number) => `${String(n)} 小时前取的`,
    daysAgo: (n: number) => `${String(n)} 天前取的`,
    download: (archive: string) => `下载 ${archive}`,
    noSha: "注册表没给校验值",
    sha: "按注册表的 sha256 校验",
    binaryNote: (check: string, run: string) => `${check}，解到 Switchback 数据目录的 agents/ 下，之后以 ${run} 启动。`,
    run: (command: string) => `运行 ${command}`,
    packageNote: (kind: string, pkg: string, tool: string) => `第一次运行时 ${kind} 会下载 ${pkg}（走你自己的 ${tool} 配置），之后用本机缓存。`,
  },
  {
    never: "not fetched yet",
    justNow: "fetched just now",
    minutesAgo: (n) => `fetched ${String(n)}m ago`,
    hoursAgo: (n) => `fetched ${String(n)}h ago`,
    daysAgo: (n) => `fetched ${String(n)}d ago`,
    download: (archive) => `download ${archive}`,
    noSha: "The registry gives no checksum",
    sha: "Checked against the registry's sha256",
    binaryNote: (check, run) => `${check}, unpacked into agents/ in Switchback's data folder, then started as ${run}.`,
    run: (command) => `run ${command}`,
    packageNote: (kind, pkg, tool) => `On first run, ${kind} downloads ${pkg} (using your own ${tool} config), then uses the local cache.`,
  },
)
