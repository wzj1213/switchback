import { count, defineMessages } from "@switchback/i18n"

/** 设置 → 数据与排查 → 外发守卫与 ZCode。 */
export const SETTINGS_GUARD = defineMessages(
  {
    guardNote:
      "看的是系统自己记的账（macOS 的 nettop，只算离开这台机器的流量，本机回环不算），" +
      "判的是引擎自己一分钟发了多少：模型对话一次请求通常几十到几百 KB，一百万 token 的上下文也就四 MB 上下；" +
      "而整个仓库连同 .git 往外打包是几百 MB。它当着你的面跑的命令（git push、npm publish）照样记账，但不拿来判——那是你让它做的事。" +
      "Switchback 只看、只停，不改引擎的配置、不挡它的请求。",
    zcodeNote:
      "2026-09 有人逆向出来：ZCode 登录着就在后台把整个工作区（完整 .git 历史、LFS 缓存、reflog）打包加密，" +
      "传到阿里云 OSS；设置里的开关管不住它。3.14.0 删掉了这条链路。待传的包先落在它的快照目录里，" +
      "给这个目录加上不可改标志，它就写不进新包。已经在里面的包是你的代码（加密的，钥匙在对方手里），Switchback 不删，要不要删你来定。",
    toolSent: (size: string) => ` · 它跑的命令发出 ${size}`,
    record: (sent: string, received: string, tool: string, peak: string) =>
      `自己发出 ${sent} · 收到 ${received}${tool} · 最多的一分钟 ${peak}`,
    reading: "正在读…",
    noRecords: "这次启动以来还没有引擎在跑。开一条会话，这里就会记下它往外发了多少。",
    installedBefore: "这台机器上装过 ZCode（它的数据目录还在）。",
    affected: (version: string) =>
      `本机装着 ZCode${version}：这一版会在后台把整个工作区连同 .git 历史打包上传（3.14.0 修掉）。建议升级或卸载。`,
    fixed: (version: string) => `本机装着 ZCode${version}，已经是修好之后的版本。`,
    locked: "已上锁：它写不进新的包，上传链路就断了。修好的版本用不到这个目录，锁着也不碍事",
    locking: "正在上锁…",
    unlocked: "没上锁：旧版本照样能把工作区打包进这个目录再传出去",
    lockLabel: "给它的快照目录上锁",
    lockToggle: "给 ZCode 的快照目录上锁",
    pendingLabel: "还没传出去的包",
    pendingHint: (n: number, size: string) => `${String(n)} 个，共 ${size}。里面是你的代码，Switchback 不删它们`,
    revealSnapshots: "在访达中显示快照目录",
    reveal: "在访达中显示",
    title: "外发守卫",
    hint: "Switchback 一直看着每个引擎进程往本机外面发了多少——不只是它说了什么。",
    stop: "批量外发时停掉",
    stopHint: "引擎自己一分钟内往外发了超过 64 MB（不算它跑的命令）就停掉它，并告诉你它当时连着谁。关掉就只提醒",
  },
  {
    guardNote:
      "It reads the system's own accounting (macOS nettop, counting only traffic that leaves this Mac, not loopback) " +
      "and judges how much the engine itself sends per minute: a model request is usually tens to hundreds of KB, and even a million-token context is only around 4 MB, " +
      "while packing up a whole repository with .git is hundreds of MB. Commands it runs in front of you (git push, npm publish) are still counted but not judged, because you asked for them. " +
      "Switchback only watches and stops; it doesn't change the engine's config or block its requests.",
    zcodeNote:
      "In 2026-09 someone reverse-engineered that ZCode, while logged in, packs up the whole workspace (full .git history, LFS cache, reflog) in the background, encrypts it, " +
      "and uploads it to Alibaba Cloud OSS; the switch in its settings doesn't stop it. 3.14.0 removed that path. Packages waiting to upload land in its snapshot folder first, " +
      "and marking that folder immutable keeps it from writing new ones. The packages already there are your code (encrypted, with the key on their side). Switchback doesn't delete them; that's your call.",
    toolSent: (size) => ` · its commands sent ${size}`,
    record: (sent, received, tool, peak) => `sent ${sent} · received ${received}${tool} · busiest minute ${peak}`,
    reading: "Reading…",
    noRecords: "No engine has run since Switchback started. Open a thread and this records how much it sends out.",
    installedBefore: "ZCode was installed on this Mac (its data folder is still here).",
    affected: (version) =>
      `ZCode${version} is installed. This version packs up the whole workspace, .git history included, and uploads it in the background (fixed in 3.14.0). Upgrade or uninstall it.`,
    fixed: (version) => `ZCode${version} is installed and already has the fix.`,
    locked: "Locked: it can't write new packages, so the upload path is cut. Fixed versions don't use this folder, so the lock does no harm",
    locking: "Locking…",
    unlocked: "Not locked: older versions can still pack the workspace into this folder and send it out",
    lockLabel: "Lock its snapshot folder",
    lockToggle: "Lock ZCode's snapshot folder",
    pendingLabel: "Packages not sent yet",
    pendingHint: (n, size) => `${count(n, "package")}, ${size} in total. They contain your code; Switchback doesn't delete them`,
    revealSnapshots: "Show the snapshot folder in Finder",
    reveal: "Show in Finder",
    title: "Egress guard",
    hint: "Switchback keeps watching how much each engine process sends off this Mac, not just what it says.",
    stop: "Stop on bulk uploads",
    stopHint: "If an engine itself sends more than 64 MB off this Mac within a minute (not counting commands it runs), stop it and say what it was connected to. When off, you're only warned",
  },
)
