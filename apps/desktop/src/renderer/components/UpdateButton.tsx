import { useEffect, useState } from "react"
import type { SelfUpdate } from "../../main/selfupdate.js"
import { ResetIcon } from "./icons-activity.js"
import { SpinnerIcon } from "./icons.js"
import type { Locale } from "@switchback/i18n"
import { useMessages } from "../i18n.js"
import { UPDATE_BUTTON } from "./UpdateButton.messages.js"

/**
 * 侧栏底部那颗**更新键**：改过的代码，一键装上。
 *
 * ## 为什么是一颗按钮，不是一行
 *
 * 上一版是整整一行「更新到最新代码 · 1ac809d…」，和账号、设置排成一列。
 * 它有两个问题：**它和常驻的那两行等重**（而它是偶发的一次性动作），
 * 以及右边那半截提交号——一个截断的哈希对着人说不出任何话。
 *
 * 现在是一颗 24 像素的圆键，只有真有新代码时才出现。**它出现本身就是那句话**，
 * 要细节的话悬停：哪个文件比装着的这份新、它将要跑哪条命令。
 *
 * ## 为什么它平时不在
 *
 * 判据见 `main/selfupdate.ts`：拿源码文件的时间跟装着的那份包比，不比版本号
 *（开发时的改动大多还没提交）。别人机器上拿到这个包时它永远不出现——
 * 那边没有源码，一颗永远点不动的按钮只是噪声。
 *
 * ## 为什么要轮询
 *
 * 你在编辑器里改完代码时 Switchback 是开着的。不轮询的话它要等下次启动才知道，
 * 而「下次启动」正是这颗按钮想省掉的那件事。60 秒一次，跑的是一条剪过枝、
 * 找到第一个就停的 `find`（实测 6 毫秒），不发任何网络请求。
 */
const POLL_MS = 60_000

export function UpdateButton(): React.JSX.Element | null {
  const bridge = typeof window === "undefined" ? undefined : window.switchback
  const [state, setState] = useState<SelfUpdate | undefined>(undefined)
  const [running, setRunning] = useState(false)
  const [failed, setFailed] = useState<string | undefined>(undefined)
  const m = useMessages(UPDATE_BUTTON)

  useEffect(() => {
    let live = true
    const look = (): void => {
      void bridge?.selfUpdateStatus().then((next) => {
        if (live) setState(next)
      })
    }
    look()
    const timer = setInterval(look, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [bridge])

  // 这台机器上没有源码（或者本来就是 `pnpm dev` 跑的）：什么都不画
  if (state?.can !== true) return null
  if (!state.stale && !running && failed === undefined) return null
  return (
    <button
      type="button"
      className={`foot__act${running ? " foot__act--busy" : ""}${failed === undefined ? "" : " foot__act--warn"}`}
      disabled={running}
      aria-label={failed === undefined ? m.update : m.retry}
      title={titleOf(state, running, failed, m)}
      onClick={() => {
        setRunning(true)
        setFailed(undefined)
        void bridge?.selfUpdate().then((r) => {
          setRunning(false)
          // 成功的话应用马上退出重开了，这里只需要管失败
          if (!r.ok) setFailed(r.output)
        })
      }}
    >
      {running ? <SpinnerIcon size={13} /> : <ResetIcon size={13} />}
    </button>
  )
}

/**
 * 悬停时把话说全。图标本身说不出这三件事，而它们缺一不可：
 *
 * - **凭什么说有新代码**：哪个文件比这份包新。不写的话这颗键就是个黑箱。
 * - **它要跑什么**：那条命令原样摆出来（`enginever.ts` 立的规矩：
 *   按钮背后不藏一条你没看过的命令）。
 * - **代价**：会退出重开，正在跑的那一轮会断。这句必须说在点之前。
 */
function titleOf(state: SelfUpdate, running: boolean, failed: string | undefined, m: (typeof UPDATE_BUTTON)[Locale]): string {
  if (failed !== undefined) return m.failedTip(failed.slice(-1200))
  if (running) return m.running
  return [m.update, state.newest === undefined ? "" : m.newer(state.newest), m.how, m.warn]
    .filter((line) => line !== "")
    .join("\n")
}
