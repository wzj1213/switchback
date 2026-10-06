import type { KimiDisconnect } from "./stream.js"

function closeNote(code: number | undefined, reason: string | undefined): string {
  const said = [code === undefined ? "" : String(code), reason ?? ""].filter((part) => part !== "").join(" ")
  return said === "" ? "" : `（${said}）`
}

/**
 * 断开原因的一句话。照实说是谁断的、对面给了什么关闭码——
 * 这句话会进 `engine.status` 的 detail，也就进了主进程日志，下回排查靠的就是它。
 */
export function disconnectText(cause: KimiDisconnect): string {
  if (cause.kind === "closed") return `Kimi 的实时连接断了${closeNote(cause.code, cause.reason)}，正在接回`
  if (cause.kind === "resync") return `Kimi 的实时流要重新同步（${cause.why}），正在按会话快照接回`
  return `Switchback 处理 Kimi 推来的消息时出错（${cause.message}），正在按会话快照接回`
}
