/**
 * 更新检查。
 *
 * ## 只查不装，这是有意的，不是没做完
 *
 * macOS 上装更新走 Squirrel.Mac，而 **Squirrel 会校验新旧两个版本的代码签名
 * 是否一致**——没签名的应用它根本不会给你装。所以在拿到 Developer ID 之前，
 * 「自动安装」这半截无论怎么写都跑不通（见 `apps/desktop/README.md` 的签名一节）。
 *
 * 那就把跑得通的那半截做扎实：查到新版本、说清楚是什么、给一个下载入口。
 * 硬塞一个 `electron-updater` 进来只会在下载完之后卡在安装那一步——
 * **一个走到最后一步才失败的更新流程，比没有更新流程糟。**
 *
 * ## 没配 feed 就完全关闭
 *
 * 不发请求、不起定时器、菜单项灰掉。omni 不该在用户没要求的情况下
 * 定期往任何地址发请求——哪怕只是一个版本号。
 */

/** 一次检查要用的东西。抽成参数是为了能在没有网络的机器上跑测试。 */
export interface UpdateDeps {
  feed: string
  current: string
  fetchText: (url: string) => Promise<string>
}

export interface Release {
  version: string
  /** 下载页或安装包地址。**用系统浏览器打开，不在应用里下载。** */
  url: string
  notes?: string
}

export type UpdateResult =
  | { kind: "newer"; release: Release }
  | { kind: "current" }
  | { kind: "off" }
  | { kind: "failed"; detail: string }

/**
 * 版本比大小。
 *
 * 自己写而不是拉一个 semver 依赖：要比的只有 `x.y.z` 加一个可选的预发布标记，
 * 而这是**主进程**——每多一个依赖就多一份供应链面。
 *
 * 两条容易写错的规则，都留了回归：
 * 1. **按数字比，不按字符串比。** `"10" < "9"` 在字符串里成立，
 *    于是 1.10.0 会被判成比 1.9.0 旧——这个 bug 要等到第十个小版本才暴露。
 * 2. **有预发布标记的比没有的小。** `1.2.0-beta.1 < 1.2.0`。
 *    反过来的话，正式版发布之后用户会被一直提示「回到 beta」。
 */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [core = "", ...rest] = v.replace(/^v/, "").split("-")
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre: rest.join("-") }
  }
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < 3; i += 1) {
    const x = a.nums[i] ?? 0
    const y = b.nums[i] ?? 0
    if (x !== y) return x > y
  }
  // 主版本号相同：没有预发布标记的更新
  if (a.pre === b.pre) return false
  if (a.pre === "") return true
  if (b.pre === "") return false
  return a.pre > b.pre
}

function parseRelease(text: string): Release | undefined {
  const raw: unknown = JSON.parse(text)
  if (typeof raw !== "object" || raw === null) return undefined
  const entry = raw as Partial<Release>
  if (typeof entry.version !== "string" || typeof entry.url !== "string") return undefined
  // 只认 https。一个能被改成 file:// 或 http:// 的更新地址，
  // 就是一条能把用户引去任意地方的路
  if (!entry.url.startsWith("https://")) return undefined
  return {
    version: entry.version,
    url: entry.url,
    ...(typeof entry.notes === "string" ? { notes: entry.notes } : {}),
  }
}

/**
 * 查一次。
 *
 * **任何失败都只返回 `failed`，绝不抛。** 更新检查是背景动作，
 * 网络抖一下不该在界面上炸出一个红框，更不该掀翻主进程。
 */
export async function checkForUpdate(deps: UpdateDeps): Promise<UpdateResult> {
  if (deps.feed === "") return { kind: "off" }
  try {
    const release = parseRelease(await deps.fetchText(deps.feed))
    if (release === undefined) return { kind: "failed", detail: "更新源返回的内容看不懂（要 version 和 https 的 url）" }
    return isNewer(release.version, deps.current) ? { kind: "newer", release } : { kind: "current" }
  } catch (error) {
    return { kind: "failed", detail: error instanceof Error ? error.message : String(error) }
  }
}


/**
 * feed 地址从哪来。
 *
 * 发布时烤进 `package.json` 的 `omni.updateFeed`；`OMNI_UPDATE_FEED`
 * 可以覆盖它（测试与企业内网自建源都要用到）。**两处都没有就是关闭**。
 */
export function feedOf(pkg: { omni?: { updateFeed?: unknown } } | undefined): string {
  const fromEnv = process.env["OMNI_UPDATE_FEED"]
  if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv
  const baked = pkg?.omni?.updateFeed
  return typeof baked === "string" ? baked : ""
}

/** 用内置 fetch 取文本，带超时。检查更新卡住不该拖住任何东西。 */
export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`更新源返回 ${String(response.status)}`)
  return response.text()
}


/**
 * 把一次检查的结果告诉用户。
 *
 * 手动点「检查更新…」时用对话框（他在等一个回答，必须有回答，
 * 哪怕答案是「已经是最新」）。背景检查时**只在有新版本时**才弹——
 * 背景动作报告「没事」是纯噪声。
 */
export async function announce(
  result: UpdateResult,
  ui: {
    ask: (options: { message: string; detail?: string; buttons: string[] }) => Promise<number>
    open: (url: string) => void
    log: (level: "info" | "warn", message: string) => void
  },
  manual: boolean,
): Promise<void> {
  if (result.kind === "off") return
  if (result.kind === "newer") {
    ui.log("info", `有新版本 ${result.release.version}`)
    const choice = await ui.ask({
      message: `有新版本 ${result.release.version}`,
      detail: [
        result.release.notes,
        // 说清楚为什么要手动装——不说的话，用户会以为这个按钮坏了
        "omni 目前只提示、不自动安装：自动安装需要应用带 Apple 开发者签名，这个包还没有。",
      ]
        .filter((x) => x !== undefined && x !== "")
        .join("\n\n"),
      buttons: ["去下载", "以后再说"],
    })
    if (choice === 0) ui.open(result.release.url)
    return
  }
  if (result.kind === "failed") {
    ui.log("warn", `检查更新失败：${result.detail}`)
    if (manual) await ui.ask({ message: "检查更新失败", detail: result.detail, buttons: ["知道了"] })
    return
  }
  if (manual) await ui.ask({ message: "已经是最新版本。", buttons: ["好"] })
}
