/**
 * 外发守卫「看」的那一半：把 `ps` 和 `nettop` 的输出读成进程树，和每个进程往本机外面发了多少。
 *
 * 纯函数：不起进程、不读时钟。起进程、定时的那一半在 `egress-guard.ts`。
 */

export interface Proc {
  pid: number
  ppid: number
  pgid: number
  /** 完整命令行（`ps -o command=`）。可执行文件的路径里可能有空格（`Switchback Helper.app`）。 */
  command: string
}

/** `ps -A -o pid=,ppid=,pgid=,command=` 的输出。读不懂的行跳过。 */
export function parsePs(text: string): Proc[] {
  const out: Proc[] = []
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line)
    if (m === null) continue
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), command: m[4] ?? "" })
  }
  return out
}

export interface Traffic {
  /** 这个进程活到现在，往本机外面发出去的字节数（累计）。 */
  sent: number
  received: number
}

/**
 * `nettop -P -L 1 -x -t external -J bytes_in,bytes_out` 的输出：`名字.pid,收,发,`。
 *
 * **只数 external**：回环不算。kimi web 跑在本机、Switchback 走 localhost 跟它说话，
 * 那些字节从来没离开过这台机器——算进来的话它每回一句话都像在往外发。
 * 名字里可能有点号，所以 pid 取最后一个点号后面那段。
 */
export function parseNettop(text: string): Map<number, Traffic> {
  const out = new Map<number, Traffic>()
  for (const line of text.split("\n")) {
    const [head, received, sent] = line.split(",")
    if (head === undefined || received === undefined || sent === undefined) continue
    const pid = Number(head.slice(head.lastIndexOf(".") + 1))
    if (!Number.isInteger(pid) || pid <= 0) continue
    out.set(pid, { sent: Number(sent) || 0, received: Number(received) || 0 })
  }
  return out
}

/** 一个被盯着的进程树：组长，加上它底下的进程分成「它自己」和「它跑的命令」两堆。 */
export interface Tree {
  leader: number
  /** 它自己：组长，和它直接拉起、不经过 shell 的那些（比如它起的 MCP 服务）。 */
  runtime: number[]
  /** 它跑的命令：往上数有一层是 shell 或常见传输工具的——那是模型调了一条命令，转录区里看得见。 */
  tools: number[]
}

/** 命令行的第一段是不是一个 shell（`/bin/zsh -c …`、登录 shell 的 `-zsh`）。 */
export function isShell(command: string): boolean {
  return /^(?:\S*\/)?-?(?:sh|bash|zsh|fish|dash|ksh|tcsh|csh|nu|pwsh)(?:\s|$)/.test(command)
}

/**
 * 算「它跑的命令」的那一层：shell，或者常见的传输工具。
 *
 * 有的引擎不经 shell、直接拉起 `git push` 这类命令——那还是模型当着你的面调的一条命令，
 * 推一个大仓库一分钟过线很正常，不该算成它自己在后台传。列的都是人会让它跑的工具，
 * 不是 node / python 这种它自己可能用来藏东西的运行时。
 */
export function isToolRoot(command: string): boolean {
  return isShell(command) || /^(?:\S*\/)?(?:git|ssh|scp|sftp|rsync|curl|wget|npm|npx|pnpm|yarn|docker|podman|gh|aws|gcloud|gsutil)(?:\s|$)/.test(command)
}

/**
 * 一个组长底下的整棵树：顺着父子关系往下找，外加同一个进程组里的（按理都在树上，
 * 父进程先退了、孤儿被过继给 launchd 的那种只能靠进程组认回来）。
 */
export function treeOf(procs: readonly Proc[], leader: number): Tree {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const children = new Map<number, Proc[]>()
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p])
  const members = new Set<number>([leader])
  const queue = [leader]
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    for (const child of children.get(pid) ?? []) {
      if (members.has(child.pid)) continue
      members.add(child.pid)
      queue.push(child.pid)
    }
  }
  for (const p of procs) if (p.pgid === leader) members.add(p.pid)
  const tree: Tree = { leader, runtime: [], tools: [] }
  for (const pid of members) (underShell(byPid, pid, leader) ? tree.tools : tree.runtime).push(pid)
  return tree
}

/** 从这个进程往上数到组长（不含），有没有一层是 shell 或传输工具。 */
function underShell(byPid: ReadonlyMap<number, Proc>, pid: number, leader: number): boolean {
  let at = byPid.get(pid)
  for (let hops = 0; at !== undefined && at.pid !== leader && hops < 64; hops++) {
    if (isToolRoot(at.command)) return true
    at = byPid.get(at.ppid)
  }
  return false
}

/**
 * 单独开着的 ZCode 桌面端的主进程。
 *
 * 主进程认法：可执行文件在 `ZCode.app/Contents/MacOS/` 底下，而且它的父进程不是另一个 ZCode 进程
 *（helper 都挂在主进程下面）。它不是 Switchback 起的，但它就是那个会把整个工作区连同 .git 打包上传的东西。
 */
export function zcodeMains(procs: readonly Proc[]): number[] {
  const isZcode = (p: Proc | undefined): boolean => p !== undefined && /\/ZCode\.app\/Contents\//.test(p.command)
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  return procs
    .filter((p) => /\/ZCode\.app\/Contents\/MacOS\//.test(p.command) && !isZcode(byPid.get(p.ppid)))
    .map((p) => p.pid)
}

/**
 * `lsof -nP -a -iTCP -sTCP:ESTABLISHED -p …` 里的对端地址（`ip:端口`），去掉本机回环。
 * 警报里说一句「当时它连着谁」：是模型的 API，还是一个对象存储。
 */
export function parseLsofPeers(text: string): string[] {
  const peers = new Set<string>()
  for (const line of text.split("\n")) {
    const peer = /->(\S+)/.exec(line)?.[1]
    if (peer === undefined || /^(?:127\.|\[::1\]|localhost)/.test(peer)) continue
    peers.add(peer)
  }
  return [...peers]
}
