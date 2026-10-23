import { useEffect, useRef, useState } from "react"
import type { Locale } from "@switchback/i18n"
import { COPY_FEEDBACK } from "./use-copy-feedback.messages.js"

const COPY_FLASH_MS = 1200

export type CopyFeedback = "idle" | "copied" | "failed"

export function copyFeedbackLabel(feedback: CopyFeedback, locale: Locale): string {
  return COPY_FEEDBACK[locale].label[feedback]
}

/** 悬停与读屏用的那句：平时说这颗键复制什么（`idle`），按过之后说结果。 */
export function copyFeedbackTitle(feedback: CopyFeedback, locale: Locale, idle: string, copied?: string): string {
  const m = COPY_FEEDBACK[locale]
  if (feedback === "copied") return copied ?? m.copied
  return feedback === "failed" ? m.failed : idle
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
