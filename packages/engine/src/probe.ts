import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { lookupCommand } from "./platform.js"

const run = promisify(execFile)

/**
 * 「这台机器上装了吗」的三种答案。
 *
 * **三态不是过度设计，两态才是错的。** 把「查不出来」压成「没装」会灰掉一个
 * 其实能用的引擎——用户于是相信自己没装，去装第二遍。反过来压成「装了」，
 * 他会一直点一个必然失败的东西。这两种错都比多一档昂贵。
 *
 * Claude 就是「查不出来」的现实例子：它的 CLI 由 SDK 自己解析，
 * 不一定在 PATH 上。`which claude` 查不到**不代表**它跑不起来。
 */
export type ProbeState = "ok" | "missing" | "unknown"

export interface Probe {
  state: ProbeState
  /** 给人看的一句话。`missing` 时必须说得出下一步做什么。 */
  detail: string
  /**
   * 真正能跑的那个绝对路径（`state: "ok"` 时才有）。
   *
   * **驱动 spawn 时要用它，不能用裸命令名**：裸名字由 PATH 再解析一次，
   * 而那次解析可能落到另一个（坏的）同名文件上——那样「探测说好、真跑的是另一个」，
   * 是最难查的一类故障。见 `resolveCommand`。
   */
  path?: string
}

const VERSION_MS = 5000

/** PATH 上所有同名的候选，按 PATH 顺序，去重。 */
async function candidates(command: string): Promise<readonly string[]> {
  const lookup = lookupCommand()
  const found = await run(lookup.command, lookup.args(command)).catch(() => undefined)
  if (found === undefined) return []
  const lines = found.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
  return [...new Set(lines)]
}

/** 这个路径跑得起来吗。跑得起来就把版本那一行带回来。 */
async function versionOf(path: string): Promise<string | undefined> {
  const out = await run(path, ["--version"], { timeout: VERSION_MS }).catch(() => undefined)
  return out === undefined ? undefined : (out.stdout.trim().split("\n")[0] ?? "")
}

/**
 * 找出**真正能跑**的那个绝对路径。
 *
 * ## 为什么不能只看 `which` 的第一行
 *
 * 真机上遇到的：`~/.vendor-cli/vendor-cli/bin/codex` 排在 homebrew 前面，
 * 而那个文件已经不在了（某个第三方 CLI 自更新时留下的空壳目录）。
 * 于是 omni 报「codex 未安装」，而 `/opt/homebrew/bin/codex` 好好的
 * ——用户看到的是「读错地方了」。
 *
 * 所以：**列出全部候选，逐个试 `--version`，第一个跑得起来的算**。
 *
 * 一个都跑不起来时**原样返回传进来的名字**，而不是 undefined：那时该让 spawn
 * 去报 ENOENT，`startupMessage` 会把它翻成「装了没、装哪了」那句人话——
 * 比我们在这里编一条准。调用方因此永远拿得到一个能直接 spawn 的值。
 */
export async function resolveCommand(command: string): Promise<string> {
  for (const path of await candidates(command)) {
    if ((await versionOf(path)) !== undefined) return path
  }
  return command
}

/**
 * 探一个命令。
 *
 * 分三步问，对应三种答案：PATH 上有哪些同名的 → 哪个跑得起来 → 版本是多少。
 * 只问第一步是不够的：装了但装坏了（依赖缺失、架构不对、空壳文件）在 `which`
 * 那关看不出来。而只看第一个也不够——理由见 `resolveCommand`。
 */
export async function probeCommand(command: string, hint?: string): Promise<Probe> {
  const paths = await candidates(command)
  if (paths.length === 0) {
    return { state: "missing", detail: [`\`${command}\` 不在 PATH 上。`, hint].filter(Boolean).join("") }
  }
  for (const path of paths) {
    const version = await versionOf(path)
    // 有的适配器 `--version` 跑得起来但什么都不打（实测 zcode-acp-server）。
    // **那时别硬接一个破折号**——`/opt/homebrew/bin/x — ` 这种尾巴看起来像出了错
    if (version !== undefined) return { state: "ok", detail: version === "" ? path : `${path} — ${version}`, path }
  }
  // 一个都跑不起来。**把试过几个说出来**：只报第一个的话，用户会拿着一条
  // 「/a/b/codex 装坏了」的提示去修一个根本不该用的文件
  const tried = paths.length === 1 ? `\`${paths[0] ?? ""}\`` : `PATH 上 ${String(paths.length)} 个同名文件（${paths.join("、")}）`
  return {
    state: "missing",
    detail: `${tried} 都跑不起来 \`--version\`——装坏了、版本不兼容，或者那只是个空壳。`,
  }
}
