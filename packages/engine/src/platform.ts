import { spawnSync } from "node:child_process"

/**
 * 平台差异的**唯一收口处**。
 *
 * 散在各处的 `process.platform === "darwin"` 是跨平台最常见的坏死方式：
 * 加第三个平台时，没人找得全那些 if。所以这里只暴露「要做的事」，
 * 不暴露「在哪个平台上」——调用方不该知道自己跑在什么系统上。
 *
 * ## 诚实声明
 *
 * **Windows 那几支没有在真机上跑过。** 写它们不是为了宣称支持 Windows，
 * 而是因为原来的实现在 Windows 上是**默默错的**：`process.kill(-pid)`
 * 在那边不是「杀进程组」，于是回收阶梯每一级都以为「已经没了」，
 * 引擎进程就这么漏在后台。错得无声无息，比明说不支持糟得多。
 */

export const isWindows = process.platform === "win32"

/**
 * 查一个命令在不在 PATH 上，该用哪个命令去查。
 *
 * `which` 是 POSIX 的；Windows 上叫 `where`（而且要写成 `where.exe`，
 * 否则在 PowerShell 里会撞上同名的 `Where-Object` 别名）。
 */
export function lookupCommand(): { command: string; args: (target: string) => string[] } {
  return isWindows
    ? { command: "where.exe", args: (target) => [target] }
    : // **`-a`：把 PATH 上所有同名的都列出来，不只第一个。** 第一个可能是别的工具
      // 塞进 PATH 的坏壳子——真机上遇到过：`~/.vendor-cli/vendor-cli/bin/codex` 排在
      // homebrew 前面而那个文件已经不存在了，于是 codex 被报成「未安装」，
      // 而 `/opt/homebrew/bin/codex` 好好的。`where.exe` 本来就列全部。
      { command: "which", args: (target) => ["-a", target] }
}

/**
 * 一棵进程树怎么收。
 *
 * POSIX：`detached: true` 让子进程成为新进程组的组长，负 pid 一次收掉整棵树，
 * 而 `kill(-pid, 0)` 就是**整树退出的证明**——这是回收阶梯敢说「收干净了」的依据。
 *
 * Windows 上这套完全不成立：`detached` 建的是新 console 而不是 POSIX 进程组，
 * 负 pid 没有「整组」的含义。那边只能靠 `taskkill /T /F` 递归杀，
 * 而且**拿不到等价的整树证明**——只能确认根进程没了。
 * 这个差别写在 `ReclaimReport` 的文档里，不能让它看起来一样可靠。
 */
export interface TreeControl {
  /**
   * 还活着吗。
   *
   * **问的是「这个 pid 领头的进程组」，不是「这个 pid」。** 传一个不是组长的
   * pid 会得到 false，哪怕那个进程活得好好的——所以只能拿它问
   * `detached: true` 起出来的那些。写测试时正是在这里踩了一次。
   *
   * Windows 上退化成「根进程还在吗」，见 `provesWholeTree`。
   */
  alive: (pid: number) => boolean
  /** 温和地请它退出。 */
  term: (pid: number) => void
  /** 强杀。 */
  kill: (pid: number) => void
  /** 这个平台上 `alive` 能不能算整树证明。诚实地报出来，别让报告撒谎。 */
  readonly provesWholeTree: boolean
}

function posixTree(): TreeControl {
  const signal = (pid: number, sig: NodeJS.Signals | 0): boolean => {
    try {
      process.kill(-pid, sig)
      return true
    } catch {
      // 已经没了。探测和发信号之间有竞态，这不是错误。
      return false
    }
  }
  return {
    alive: (pid) => signal(pid, 0),
    term: (pid) => {
      signal(pid, "SIGTERM")
    },
    kill: (pid) => {
      signal(pid, "SIGKILL")
    },
    provesWholeTree: true,
  }
}

function windowsTree(): TreeControl {
  // 同步 spawn：回收路径上不能有 await 之外的异步分叉，否则「杀完再确认」
  // 的顺序就没了保证。taskkill 是毫秒级的，同步的代价可以接受。
  const taskkill = (pid: number, force: boolean): void => {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])], { windowsHide: true })
    } catch {
      // 杀不掉就杀不掉，上层会走到 escaped 那一级并报出来
    }
  }
  return {
    alive: (pid) => {
      try {
        // **正 pid**：Windows 上负数没有「进程组」的含义，
        // 传负数不是「收整棵树」，而是一个无意义的 pid
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },
    term: (pid) => {
      taskkill(pid, false)
    },
    kill: (pid) => {
      taskkill(pid, true)
    },
    provesWholeTree: false,
  }
}

export const tree: TreeControl = isWindows ? windowsTree() : posixTree()

/**
 * 从登录 shell 里问出真正的 PATH。
 *
 * ## 为什么非做不可
 *
 * macOS 上从 Dock/Finder 启动的进程，PATH 恒为
 * `/usr/bin:/bin:/usr/sbin:/sbin`——`launchctl getenv PATH` 是空的，
 * 图形进程根本不经过 shell 的 rc 文件。而 codex 装在 `/opt/homebrew/bin`，
 * ACP 引擎多半在 `~/.local/bin` 或 npm 的全局目录。
 *
 * 于是：`pnpm dev` 里一切正常（终端启动，PATH 是全的），**装出来的包一开就找不到引擎**，
 * 而这正好是唯一有真实用户的那条路。
 *
 * ## 为什么光有绝对路径不够
 *
 * 就算用户在 engines.json 里写死 `/opt/homebrew/bin/codex` 也照样挂：
 * 那是个 `#!/usr/bin/env node` 脚本，spawn **成功**、子进程立刻以 127 退出，
 * 报错是 `env: node: No such file or directory`——既不提 PATH 也不提 codex，
 * 比 ENOENT 更难查。**PATH 是给解释器用的，不只是给可执行文件用的。**
 *
 * ## 为什么用哨兵包起来
 *
 * 交互式登录 shell 会把 rc 文件里的东西一起打出来（nvm 的提示、fortune、
 * 各种 `echo`）。取最后一行不可靠——有人的 rc 结尾就打空行。
 * 用哨兵夹住，从输出里精确抠出来。
 */
const SENTINEL = { start: "__OMNI_PATH__", end: "__OMNI_END__" }

/**
 * 问不到时垫上的常见位置。
 *
 * ## 为什么必须有 Node 版本管理器那一族
 *
 * 上一版只有五个目录，**整族 Node 版本管理器都不在里面**——而 claude / codex /
 * kimi 全是 npm 装的，绝大多数人的 node 由 nvm / volta / fnm / asdf / mise 管着。
 * 于是「登录 shell 那一问超时了」这条支线直接等于「npm 装的引擎全部找不到」，
 * 而**最容易超时的机器恰恰就是 rc 里 source 了版本管理器的那些**——
 * 兜底方案在最需要它的场合失效，是最坏的一种兜底。
 *
 * nvm 那条写 `~/.nvm/current/bin`：真目录是 `~/.nvm/versions/node/<版本>/bin`，
 * 这里不能展开通配（PATH 不认），而 `current` 是 nvm 自己维护的符号链接
 * ——**在就对，不在也只是白搭一格**。提供 shims 的（asdf / mise）指 shims，
 * 它们自己会转发到当前版本。
 *
 * 多垫几个目录的代价只有 `which` 多走几步；漏一个的代价是一整类机器上
 * 引擎全部「未安装」。这个不对称决定了这张表宁可长。
 */
const COMMON = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "~/.local/bin",
  "~/.bun/bin",
  "~/.cargo/bin",
  // npm / pnpm 的全局 bin
  "~/.npm-global/bin",
  "~/Library/pnpm",
  // Node 版本管理器
  "~/.volta/bin",
  "~/.nvm/current/bin",
  "~/.asdf/shims",
  "~/.local/share/mise/shims",
]

export interface LoginPathDeps {
  shell: string | undefined
  home: string | undefined
  platform: string
  run: (cmd: string, args: readonly string[], timeoutMs: number) => Promise<string | undefined>
}

/**
 * @returns 补齐后的 PATH。**永远不返回比传入更窄的东西**——问 shell 失败时
 *   退回「原样 + 常见位置」，而不是把用户原有的 PATH 换掉。
 */
export async function resolveLoginPath(current: string, deps: LoginPathDeps): Promise<string> {
  // Windows 的 GUI 进程正常继承用户环境变量，没有这个问题；跑一次 shell 反而是纯风险
  if (deps.platform === "win32") return current
  const shell = deps.shell ?? "/bin/zsh"
  const script = `printf '%s%s%s' '${SENTINEL.start}' "$PATH" '${SENTINEL.end}'`
  /*
   * 5 秒，不是 3 秒。
   *
   * `-i` 会读 `.zshrc`，而那正是绝大多数人设置 PATH 的地方（nvm / oh-my-zsh /
   * conda 的初始化全在那儿）。3 秒对一台装了 oh-my-zsh + nvm 的机器是紧的，
   * 而**超时的后果不是慢一点，是拿不到真 PATH**——只能退到下面那张兜底表，
   * 于是这台机器上所有 npm 装的引擎都得靠猜目录去撞。
   *
   * 多等 2 秒只发生在 shell 真的很慢或者卡死的时候；换来的是那些机器
   * 拿到**准确**的 PATH 而不是一张通用清单。上限仍然要有：rc 里可以有任何东西
   *（等网络、等输入），没有硬超时的话代价是整个应用起不来。
   */
  const out = await deps.run(shell, ["-ilc", script], 5000).catch(() => undefined)
  const asked = out === undefined ? undefined : between(out, SENTINEL.start, SENTINEL.end)
  const home = deps.home
  const extras = COMMON.map((p) => (p.startsWith("~/") && home !== undefined ? `${home}/${p.slice(2)}` : p))
  return merge([asked, current, extras.join(":")])
}

function between(text: string, start: string, end: string): string | undefined {
  const a = text.indexOf(start)
  if (a === -1) return undefined
  const b = text.indexOf(end, a + start.length)
  if (b === -1) return undefined
  const value = text.slice(a + start.length, b).trim()
  return value === "" ? undefined : value
}

/** 按先后顺序合并几段 PATH，**保持先来的优先**并去重。 */
function merge(parts: readonly (string | undefined)[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    for (const dir of (part ?? "").split(":")) {
      if (dir === "" || seen.has(dir)) continue
      seen.add(dir)
      out.push(dir)
    }
  }
  return out.join(":")
}
