import { spawn, type ChildProcess } from "node:child_process"
import { tree } from "./platform.js"
import { sep } from "node:path"

/**
 * 起一个引擎进程要的最少信息。
 *
 * 有意**不** import Claude SDK 的 `SpawnOptions`：本模块给所有引擎共用，
 * codex 驱动也要靠它拿进程组所有权，不该为此背上一个厂商 SDK 的类型。
 * 结构上是兼容的——SDK 递过来的对象字段是这几个的超集。
 */
export interface SpawnRequest {
  command: string
  args: readonly string[]
  cwd?: string
  env?: Readonly<Record<string, string | undefined>>
}

export interface ReclaimConfig {
  /** 引擎自己的优雅退出窗口之后，我们再等多久让它自己退 */
  exitGraceMs: number
  /** SIGTERM 之后等多久再升级到 SIGKILL */
  termGraceMs: number
  /** SIGKILL 之后等多久确认整树消失 */
  killGraceMs: number
}

const DEFAULTS: ReclaimConfig = { exitGraceMs: 3000, termGraceMs: 3000, killGraceMs: 1000 }

/** 走到了阶梯的哪一级。`escaped` 是失败——必须上报，不能当成正常。 */
export type Rung = "never-spawned" | "already-exited" | "graceful" | "sigterm" | "sigkill" | "escaped"

export interface ReclaimReport {
  rung: Rung
  pid: number | undefined
  exitCode: number | null
  signal: NodeJS.Signals | null
  durationMs: number
}

export interface ProcessOwner {
  /** Claude 侧交给 SDK 的 `spawnClaudeCodeProcess`；codex 侧自己调。 */
  spawn: (options: SpawnRequest) => ChildProcess
  /**
   * 起进程本身失败了吗（`ENOENT`、权限不足这一类）。
   *
   * **必须有人问这一句。** `ChildProcess` 的 `error` 事件没人监听时会变成
   * 未捕获异常，直接掀翻整个进程——在 Electron 主进程里就是应用当场退出。
   * 本模块无条件挂上监听，把错误存下来交给调用方判断。
   */
  failure: () => Error | undefined
  /**
   * 进程起不来或过早退出时 resolve（永不 reject）。
   *
   * 用来和握手**赛跑**：起不来这件事在毫秒级就已知，不该让用户干等一个
   * 二十秒的超时。没 spawn 过的话这个 promise 永远挂着——那正是我们要的，
   * 它只在 race 的另一边有意义。
   */
  died: () => Promise<Error>
  /** 回收阶梯。幂等；返回时要么有退出证明，要么 rung 是 `escaped`。 */
  reclaim: () => Promise<ReclaimReport>
}

/**
 * 把指进 asar 的路径改到解包目录。
 *
 * 打包之后引擎的可执行文件落在 `.../Resources/app.asar/node_modules/...`。
 * Electron 给 `fs` 打了补丁能透明读 asar 里的文件，**但 `spawn` 交给的是操作系统**，
 * 而 asar 是一个文件不是目录——于是报 `spawn ENOTDIR`。
 *
 * 打包配置里已经把这些依赖 `asarUnpack` 出去了，真实文件就在旁边的
 * `app.asar.unpacked/` 里；这里只需要把路径指过去。
 *
 * **只有真打包才会撞上这个**：开发时跑的是源码目录，路径里根本没有 asar。
 */
export function unpacked(path: string): string {
  return path.includes(`${sep}app.asar${sep}`)
    ? path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
    : path
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 整个进程组还活着吗。
 *
 * `kill(-pid, 0)` 不发信号，只做存在性探测：ESRCH 表示组里一个都不剩。
 * 这就是**整树退出证明**——只看直接子进程的 exitCode 是不够的，
 * claude 自己会 spawn bash 之类的孙子进程，父进程死了它们可能还在跑。
 */
/**
 * 「整棵树还在吗」「怎么收它」全部委托给 `platform.ts`。
 *
 * 原来这里直接写死 `process.kill(-pid, …)`——那是 POSIX 的进程组语义，
 * 在 Windows 上负 pid 根本不是「进程组」。结果是回收阶梯每一级都以为
 * 「已经没了」，引擎进程默默漏在后台。**错得无声无息，比明说不支持糟得多。**
 */
const groupAlive = (pid: number): boolean => tree.alive(pid)

interface Owned {
  child: ChildProcess
  exited: boolean
  code: number | null
  signal: NodeJS.Signals | null
  error: Error | undefined
  died: Promise<Error>
  settle: (error: Error) => void
}

/**
 * 接管一个刚起的子进程。
 *
 * 两件事都不能省：`error` 必须无条件监听（没人听就是未捕获异常，掀翻整个进程），
 * `died` 必须只 resolve 一次（后续的 exit 不该覆盖最先发生的那个原因）。
 */
function own(child: ChildProcess): Owned {
  const deferred: { settle: (error: Error) => void } = { settle: () => undefined }
  const died = new Promise<Error>((resolve) => {
    deferred.settle = resolve
  })
  const owned: Owned = {
    child,
    exited: false,
    code: null,
    signal: null,
    error: undefined,
    died,
    settle: deferred.settle,
  }
  child.on("error", (error: Error) => {
    owned.error = error
    owned.exited = true
    owned.settle(error)
  })
  child.on("exit", (code, signal) => {
    owned.exited = true
    owned.code = code
    owned.signal = signal
    owned.settle(new Error(`进程已退出（code ${String(code)}${signal === null ? "" : ` signal ${signal}`}）`))
  })
  return owned
}

export function createProcessOwner(config: Partial<ReclaimConfig> = {}): ProcessOwner {
  const cfg = { ...DEFAULTS, ...config }
  const state: { owned: Owned | undefined } = { owned: undefined }

  const doSpawn = (options: SpawnRequest): ChildProcess => {
    // detached: true 让子进程成为新进程组的组长，我们才能用负 pid 一次收掉整棵树。
    // 代价：omni 硬崩时子进程不会被系统连坐带走——这是有意的取舍，见 README。
    const child = spawn(unpacked(options.command), options.args.map(unpacked), {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    })
    state.owned = own(child)
    return child
  }

  const report = (rung: Rung, started: number): ReclaimReport => {
    const owned = state.owned
    return {
      rung,
      pid: owned?.child.pid,
      exitCode: owned?.code ?? null,
      signal: owned?.signal ?? null,
      durationMs: Date.now() - started,
    }
  }

  /** 轮询等待整组消失，最多 `budget` 毫秒。返回是否等到了。 */
  const settle = async (pid: number, budget: number): Promise<boolean> => {
    const deadline = Date.now() + budget
    while (Date.now() < deadline) {
      if (!groupAlive(pid)) return true
      await wait(50)
    }
    return !groupAlive(pid)
  }

  const reclaim = async (): Promise<ReclaimReport> => {
    const started = Date.now()
    const owned = state.owned
    if (owned === undefined) return report("never-spawned", started)
    const pid = owned.child.pid
    if (pid === undefined) return report("already-exited", started)
    if (!groupAlive(pid)) return report("already-exited", started)

    if (await settle(pid, cfg.exitGraceMs)) return report("graceful", started)
    tree.term(pid)
    if (await settle(pid, cfg.termGraceMs)) return report("sigterm", started)
    tree.kill(pid)
    if (await settle(pid, cfg.killGraceMs)) return report("sigkill", started)
    return report("escaped", started)
  }

  return {
    spawn: doSpawn,
    failure: () => state.owned?.error,
    // 没 spawn 过就永远挂着——它只在 race 的另一边有意义
    died: () => state.owned?.died ?? new Promise<Error>(() => undefined),
    reclaim,
  }
}
