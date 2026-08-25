import type { Event, ThreadId } from "@omni/protocol"

interface RawPluginInstall {
  status?: unknown
  name?: unknown
  error?: unknown
}

interface PluginInstallContext {
  threadId: ThreadId
  at: number
  emit: (event: Event) => void
}

const SUCCESS_TIMEOUT_MS = 5000

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function emit(ctx: PluginInstallContext, event: Omit<Extract<Event, {
  type: "engine.notification"
}>, "type" | "at" | "threadId" | "engine">): void {
  ctx.emit({
    type: "engine.notification", at: ctx.at, threadId: ctx.threadId, engine: "claude", ...event,
  })
}

/** 用户原生开启同步安装时，保留 SDK 公开的启动进度；不替用户开启该环境变量。 */
export function emitPluginInstall(msg: RawPluginInstall, ctx: PluginInstallContext): void {
  const name = nonEmpty(msg.name)
  const error = nonEmpty(msg.error)
  if (msg.status === "started") {
    emit(ctx, {
      key: "plugin-install", message: "Claude 正在同步配置中的插件…", priority: "medium",
    })
    return
  }
  if (msg.status === "completed") {
    emit(ctx, {
      key: "plugin-install", message: "Claude 插件同步流程已结束", priority: "low",
      timeoutMs: SUCCESS_TIMEOUT_MS,
    })
    return
  }
  if (msg.status === "installed" && name !== undefined) {
    emit(ctx, {
      key: `plugin-install:${name}`, message: `Claude 已同步插件来源：${name}`, priority: "low",
      timeoutMs: SUCCESS_TIMEOUT_MS,
    })
    return
  }
  if (msg.status !== "failed") return
  const subject = name === undefined ? "Claude 插件同步失败" : `Claude 插件来源同步失败：${name}`
  emit(ctx, {
    key: `plugin-install:${name ?? "unknown"}`,
    message: error === undefined ? subject : `${subject} — ${error}`,
    priority: "immediate",
    color: "error",
  })
}
