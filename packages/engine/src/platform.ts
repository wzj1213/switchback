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
    : { command: "which", args: (target) => [target] }
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
