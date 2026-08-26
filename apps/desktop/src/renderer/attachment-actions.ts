import { canAttachImage } from "../shared/attachments.js"
import { dropNotice } from "./attachment-feedback.js"
import { fileReference } from "./file-references.js"

type Bridge = Pick<NonNullable<Window["omni"]>, "pathForFile" | "pickImages" | "stashImage">

export interface AttachmentResult {
  paths: readonly string[]
  references: readonly string[]
  notice?: { text: string; tone: "info" | "warn" }
}

function unavailable(): AttachmentResult {
  return {
    paths: [], references: [],
    notice: { text: "文件入口暂时不可用，请重新打开 omni。", tone: "warn" },
  }
}

interface Routed {
  paths: string[]
  references: string[]
  failed: number
  outside: string[]
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
  const references = [...new Set(result.references)]
  const outside = new Set(result.outside).size
  const text = dropNotice({ images: result.paths.length, references: references.length,
    failed: result.failed, outside })
  return {
    paths: result.paths,
    references,
    ...(text === undefined ? {} : { notice: {
      text, tone: result.failed > 0 || outside > 0 ? "warn" as const : "info" as const,
    } }),
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
  for (const file of files) {
    if (file === null) {
      result.failed += 1
    } else if (enabled && canAttachImage(file)) {
      const saved = await stash(bridge, file)
      if (saved === undefined) routeReference(result, cwd, pathOf(bridge, file))
      else result.paths.push(saved)
    } else {
      routeReference(result, cwd, pathOf(bridge, file))
    }
  }
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

export async function pickedImages(bridge: Bridge | undefined): Promise<AttachmentResult> {
  if (bridge === undefined) return unavailable()
  try {
    const result = await bridge.pickImages()
    if (result.canceled) return { paths: [], references: [] }
    if (result.rejected === 0) return { paths: result.paths, references: [] }
    const added = result.paths.length
    const notice = added > 0
      ? `已添加 ${String(added)} 张；另有 ${String(result.rejected)} 个文件未添加。`
      : "未添加：图片为空、超过 12 MB，或格式不受支持。"
    return { paths: result.paths, references: [], notice: { text: notice, tone: "warn" } }
  } catch {
    return unavailable()
  }
}
