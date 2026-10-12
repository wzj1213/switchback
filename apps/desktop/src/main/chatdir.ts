import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"
import type { Channels } from "./channels.js"

/**
 * 给一条「不属于任何项目的对话」准备一个真目录。
 *
 * ## 为什么不让 cwd 为空
 *
 * `cwd` 是**工作区边界的唯一真源**，三处都靠它：
 *
 * - 子进程的工作目录——空了就继承主进程的，而打包后那是 `/`
 * - 审批红线的「在不在工作区内」——空了等于整个磁盘都在里面
 * - 审批记忆规则按 cwd 分桶——空了全并成一桶，在 A 对话点的
 *   「本项目始终允许」会在 B 对话默认生效，这是权限降级
 *
 * 所以对话也有目录，只是自动生成的。代价是磁盘上多几个空文件夹，
 * 换来的是这三条一行都不用改。codex 那边也是这么做的
 *（projectless 的会话落在 `Documents/Codex` 下）。
 *
 * ## 为什么按日期分
 *
 * 一天开五条随手问的对话很正常。全平铺在一个目录下，
 * 半年后那儿会有几百个文件夹；按天分至少让人能照着日期找回去。
 */
export function installChatDirChannel(channels: Channels): void {
  channels.handle("switchback:chatDir", async () => {
    const now = new Date()
    const day = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const at = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const dir = join(app.getPath("documents"), "Switchback", day, `对话-${at}`)
    await mkdir(dir, { recursive: true })
    return dir
  })
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}
