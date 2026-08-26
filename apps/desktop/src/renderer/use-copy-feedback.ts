import { useEffect, useRef, useState } from "react"

const COPY_FLASH_MS = 1200

export type CopyFeedback = "idle" | "copied" | "failed"

export function copyFeedbackLabel(feedback: CopyFeedback): string {
  if (feedback === "copied") return "已复制"
  return feedback === "failed" ? "复制失败" : "复制"
}

export function copyFeedbackTitle(feedback: CopyFeedback, idle: string, copied = "内容已复制"): string {
  if (feedback === "copied") return copied
  return feedback === "failed" ? "复制失败，请重试" : idle
}

export async function resolveCopyFeedback(copy: () => unknown): Promise<CopyFeedback> {
  try {
    return (await copy()) === false ? "failed" : "copied"
  } catch {
    return "failed"
  }
}

export function useCopyFeedback(copyAction: () => unknown): [CopyFeedback, () => void] {
  const [feedback, setFeedback] = useState<CopyFeedback>("idle")
  const [revision, setRevision] = useState(0)
  const latest = useRef(0)
  useEffect(() => {
    if (feedback === "idle") return undefined
    const timer = window.setTimeout(() => { setFeedback("idle") }, COPY_FLASH_MS)
    return () => { window.clearTimeout(timer) }
  }, [feedback, revision])
  useEffect(() => () => { latest.current += 1 }, [])
  const copy = (): void => {
    const attempt = latest.current + 1
    latest.current = attempt
    void resolveCopyFeedback(copyAction).then((next) => {
      if (latest.current !== attempt) return
      setFeedback(next)
      setRevision((before) => before + 1)
    })
  }
  return [feedback, copy]
}
