import { useMemo } from "react"
import type { EnvConfig } from "../shared/hooks.js"
import { bridge, useAsync, type Async } from "./use-async.js"

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
 *
 * ## 只剩一层薄壳
 *
 * 「读一次 + 能重读 + 分得清读挂了」那套已经收进 `useAsync`（原来面板里有四份手抄的
 * 副本，每一份都少了一样）。留着这个文件是因为**「传哪个 cwd」是这一页自己的事**。
 */
export function useEnvConfig(cwd: string | undefined): Async<EnvConfig> {
  const omni = bridge()
  const load = useMemo(
    () => (omni === undefined ? undefined : () => omni.envConfig(cwd)),
    [omni, cwd],
  )
  return useAsync<EnvConfig>(load)
}
