import { useCallback, useEffect, useRef, useState } from "react"
import { droppedFiles, pasteFiles, pickedFiles, type AttachmentResult } from "./attachment-actions.js"
import { dropNotice } from "./attachment-feedback.js"
import { newFileReferences } from "./file-references.js"

/**
 * 输入区的附件：贴进来、拖进来、去掉。
 *
 * ## 图片走附件，其他文件走可见引用
 *
 * 只有引擎正式报告支持的图片才进入附件数组；其他文件不冒充附件，改为把用户
 * 亲手选择的路径写进输入框。外部文件不复制进项目，能否读取继续由引擎自己的权限决定。
 *
 * ## 为什么存路径不存字节
 *
 * 见 `main/attach.ts`：两家引擎都更喜欢路径，而且落了盘的图**事后还能打开**
 * ——会话记录里那句「看看这个报错」配的是哪张图，三天后还查得到。
 */
export interface Attachments {
  paths: readonly string[]
  /** 最近一次添加结果；成功或失败都会短暂出现，然后自动消失。 */
  notice?: { text: string; tone: "info" | "warn" }
  /** 处理一次粘贴。默认粘贴必须由调用方在异步落盘前同步拦住。 */
  paste: (items: DataTransferItemList | null, cwd: string, text: string) => Promise<readonly string[]>
  /** 处理一次拖放。 */
  drop: (files: FileList | null, cwd: string, text: string) => AttachmentAcceptance
  /** 打开系统文件选择器；返回需要写进正文的可见路径引用。 */
  pick: (cwd: string, text: string) => Promise<readonly string[]>
  /** 用一组已经落盘的路径替换当前附件（取回队列 / 改一改再发）。 */
  replace: (paths: readonly string[]) => void
  remove: (path: string) => void
  clear: () => void
}

export interface AttachmentAcceptance {
  references: readonly string[]
  accepted: boolean
  notice?: { text: string; tone: "info" | "warn" }
}

export function attachmentAcceptance(result: AttachmentResult): AttachmentAcceptance {
  return {
    references: result.references,
    accepted: result.paths.length > 0 || result.references.length > 0,
    ...(result.notice === undefined ? {} : { notice: result.notice }),
  }
}

export function withoutExistingAttachments(
  result: AttachmentResult,
  existingPaths: ReadonlySet<string>,
  text: string,
): AttachmentResult {
  if (result.summary === undefined) return result
  const paths = result.paths.filter((path) => !existingPaths.has(path))
  const references = newFileReferences(text, result.references)
  const outsideReferences = (result.outsideReferences ?? [])
    .filter((path) => references.includes(path))
  const summary = {
    ...result.summary,
    images: paths.length,
    references: references.length,
    outside: outsideReferences.length,
    duplicates: result.summary.duplicates + result.paths.length - paths.length
      + result.references.length - references.length,
  }
  const notice = dropNotice(summary)
  return {
    paths,
    references,
    summary,
    outsideReferences,
    ...(notice === undefined ? {} : { notice: {
      text: notice,
      tone: summary.failed > 0 || summary.outside > 0 ? "warn" as const : "info" as const,
    } }),
  }
}

function useAttachmentNotice(): [Attachments["notice"], (notice: Attachments["notice"]) => void] {
  const [notice, setNotice] = useState<Attachments["notice"]>()
  useEffect(() => {
    if (notice === undefined) return undefined
    const timer = window.setTimeout(() => { setNotice(undefined) }, 5000)
    return () => { window.clearTimeout(timer) }
  }, [notice])
  return [notice, setNotice]
}

export function useAttachments(enabled: boolean, initial: readonly string[] = []): Attachments {
  const [paths, setPaths] = useState<readonly string[]>(() => [...new Set(initial)])
  const knownPaths = useRef(new Set(initial))
  const [notice, setNotice] = useAttachmentNotice()
  const bridge = typeof window === "undefined" ? undefined : window.omni

  const accept = useCallback((raw: AttachmentResult, text: string): AttachmentAcceptance => {
    const result = withoutExistingAttachments(raw, knownPaths.current, text)
    if (result.paths.length > 0) {
      // 同一张图贴两次没有意义，而且会让模型多读一遍
      for (const path of result.paths) knownPaths.current.add(path)
      setPaths((prev) => [...prev, ...result.paths])
    }
    setNotice(result.notice)
    return attachmentAcceptance(result)
  }, [])

  const paste = useCallback(async (
    items: DataTransferItemList | null,
    cwd: string,
    text: string,
  ): Promise<readonly string[]> => {
    return accept(await pasteFiles(items, enabled, bridge, cwd), text).references
  }, [accept, bridge, enabled])

  const drop = useCallback((files: FileList | null, cwd: string, text: string): AttachmentAcceptance => {
    return accept(droppedFiles(files, enabled, bridge, cwd), text)
  }, [accept, bridge, enabled])

  const pick = useCallback(async (cwd: string, text: string): Promise<readonly string[]> => {
    return accept(await pickedFiles(bridge, enabled, cwd), text).references
  }, [accept, bridge, enabled])

  return {
    paths,
    notice,
    paste,
    drop,
    pick,
    replace: useCallback((next: readonly string[]) => {
      const unique = [...new Set(next)]
      const removed = paths.filter((path) => !unique.includes(path))
      if (removed.length > 0) bridge?.discardImages(removed)
      knownPaths.current = new Set(unique)
      setPaths(unique)
      setNotice(undefined)
    }, [bridge, paths]),
    remove: useCallback((path: string) => {
      if (!paths.includes(path)) return
      bridge?.discardImages([path])
      knownPaths.current.delete(path)
      setPaths((prev) => prev.filter((p) => p !== path))
    }, [bridge, paths]),
    clear: useCallback(() => {
      knownPaths.current.clear()
      setPaths([])
      setNotice(undefined)
    }, []),
  }
}
