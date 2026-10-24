/** 主进程唯一允许交给系统处理的外链协议。 */
export function safeExternalUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "mailto:") return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

export interface ExternalUrlDeps {
  open: (url: string) => Promise<void>
  report: (message: string) => void
}

/**
 * 外链最后一道特权边界。
 *
 * renderer 会展示引擎生成的 Markdown；这里不相信上游已经过滤过协议。
 */
export async function openExternalSafely(raw: string, deps: ExternalUrlDeps): Promise<boolean> {
  const url = safeExternalUrl(raw)
  if (url === undefined) {
    deps.report(`已拦截不受支持的外链：${raw}`) // i18n-ok：report 进日志
    return false
  }
  try {
    await deps.open(url)
    return true
  } catch (error) {
    deps.report(`打开外链失败：${String(error)}`) // i18n-ok：同上
    return false
  }
}
