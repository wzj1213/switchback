import { useCallback, useEffect, useState } from "react"
import type { EnvConfig } from "../shared/hooks.js"

/**
 * 「环境」那一页的数据。真源在主进程（`main/envconfig.ts`），这里只做**要一次**。
 *
 * ## 每次打开都重新问
 *
 * 这几份配置是用户在别的窗口里手改的（编辑器、终端里 `codex` 审了一条钩子），
 * omni 没有任何办法知道它们变了。而**一份过期的「生效中」比不显示更危险**——
 * 这条和 `EnvCard` 里重新问分支名是同一个道理。
 *
 * 代价是打开这一页要读三五个文件（毫秒级，全在主进程），不值得为它做缓存。
 */
export interface EnvConfigApi {
  data: EnvConfig | undefined
  loading: boolean
  /** 手动再读一遍。改完配置不想关窗口重开时用。 */
  reload: () => void
}

export function useEnvConfig(cwd: string | undefined): EnvConfigApi {
  const [data, setData] = useState<EnvConfig | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  // 计数而不是布尔：连点两次「重新读」应该真的读两次（和 `useShell` 里
  // 那几个信号同一条规矩）
  const [nonce, setNonce] = useState(0)
  const bridge = typeof window === "undefined" ? undefined : window.omni

  useEffect(() => {
    if (bridge === undefined) return undefined
    let live = true
    setLoading(true)
    void bridge.envConfig(cwd).then((next) => {
      if (!live) return
      setData(next)
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [bridge, cwd, nonce])

  return {
    data,
    loading,
    reload: useCallback(() => {
      setNonce((n) => n + 1)
    }, []),
  }
}
