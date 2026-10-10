import { canAttachImage, imageExtension, MAX_IMAGE_BYTES } from "../shared/attachments.js"
import { dropNotice, type AttachmentSummary } from "./attachment-feedback.js"
import { fileReference } from "./file-references.js"

type Bridge = Pick<NonNullable<Window["switchback"]>, "pathForFile" | "pickFiles" | "stashImage">

export interface AttachmentResult {
  paths: readonly string[]
  references: readonly string[]
  summary?: AttachmentSummary
  outsideReferences?: readonly string[]
  notice?: { text: string; tone: "info" | "warn" }
}

function unavailable(): AttachmentResult {
  return {
    paths: [], references: [],
    notice: { text: "文件入口暂时不可用，请重新打开 Switchback。", tone: "warn" },
  }
}

interface Routed {
  paths: string[]
  references: string[]
  failed: number
  outside: string[]
  /** 粘贴来的图太大（剪贴板里的图没有路径，引用不了）。 */
  oversized?: number
}

function routeReference(result: Routed, cwd: string, path: string): void {
  if (path === "") {
    result.failed += 1
    return
  }
  const reference = fileReference(cwd, path)
  result.references.push(reference.path)
  if (reference.outside) result.outside.push(reference.path)
}

function pathOf(bridge: Bridge, file: File): string {
  try { return bridge.pathForFile(file) } catch { return "" }
}

async function stash(bridge: Bridge, file: File): Promise<string | undefined> {
  try {
    return await bridge.stashImage(file.type, await file.arrayBuffer())
  } catch {
    return undefined
  }
}

function finish(result: Routed): AttachmentResult {
  const paths = [...new Set(result.paths)]
  const references = [...new Set(result.references)]
  const outsideReferences = [...new Set(result.outside)]
  const duplicates = result.paths.length - paths.length + result.references.length - references.length
  const summary = { images: paths.length, references: references.length,
    failed: result.failed, outside: outsideReferences.length, duplicates,
    ...(result.oversized === undefined ? {} : { oversized: result.oversized }) }
  const text = dropNotice(summary)
  return {
    paths,
    references,
    summary,
    outsideReferences,
    ...(text === undefined ? {} : { notice: {
      text, tone: result.failed > 0 || (result.oversized ?? 0) > 0 || outsideReferences.length > 0 ? "warn" as const : "info" as const,
    } }),
  }
}

/** 粘贴进来的一项落到哪：附件、可见引用，或者数进失败 / 太大。 */
async function routePasted(
  result: Routed,
  file: File | null,
  ctx: { enabled: boolean; bridge: Bridge; cwd: string },
): Promise<void> {
  const { enabled, bridge, cwd } = ctx
  if (file === null) {
    result.failed += 1
  } else if (enabled && imageExtension(file.type) !== undefined && file.size > MAX_IMAGE_BYTES && pathOf(bridge, file) === "") {
    // 截图之类：读得到、只是超过上限，又没有路径可引用。说「未能读取」是假话
    result.oversized = (result.oversized ?? 0) + 1
  } else if (enabled && canAttachImage(file)) {
    const saved = await stash(bridge, file)
    if (saved === undefined) routeReference(result, cwd, pathOf(bridge, file))
    else result.paths.push(saved)
  } else {
    routeReference(result, cwd, pathOf(bridge, file))
  }
}

export async function pasteFiles(
  items: DataTransferItemList | null,
  enabled: boolean,
  bridge: Bridge | undefined,
  cwd: string,
): Promise<AttachmentResult> {
  const files = Array.from(items ?? []).filter((item) => item.kind === "file").map((item) => item.getAsFile())
  if (bridge === undefined) return unavailable()
  const result: Routed = { paths: [], references: [], failed: 0, outside: [] }
  for (const file of files) await routePasted(result, file, { enabled, bridge, cwd })
  return finish(result)
}

export function droppedFiles(
  list: FileList | null,
  enabled: boolean,
  bridge: Bridge | undefined,
  cwd: string,
): AttachmentResult {
  const files = Array.from(list ?? [])
  if (bridge === undefined) return unavailable()
  const result: Routed = { paths: [], references: [], failed: 0, outside: [] }
  for (const file of files) {
    const path = pathOf(bridge, file)
    if (enabled && canAttachImage(file) && path !== "") result.paths.push(path)
    else routeReference(result, cwd, path)
  }
  return finish(result)
}

export async function pickedFiles(
  bridge: Bridge | undefined,
  enabled: boolean,
  cwd: string,
): Promise<AttachmentResult> {
  if (bridge === undefined) return unavailable()
  try {
    const picked = await bridge.pickFiles()
    if (picked.canceled) return { paths: [], references: [] }
    const routed: Routed = { paths: [], references: [], failed: picked.failed, outside: [] }
    for (const file of picked.files) {
      if (enabled && file.image) routed.paths.push(file.path)
      else routeReference(routed, cwd, file.path)
    }
    return finish(routed)
  } catch {
    return unavailable()
  }
}
