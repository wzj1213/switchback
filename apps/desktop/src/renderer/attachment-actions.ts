import { canAttachImage } from "../shared/attachments.js"
import { dropNotice, reviewAttachments } from "./attachment-feedback.js"

type Bridge = Pick<NonNullable<Window["omni"]>, "pathForFile" | "pickImages" | "stashImage">

export interface AttachmentResult {
  paths: readonly string[]
  notice?: string
}

function unavailable(): AttachmentResult {
  return { paths: [], notice: "图片附件入口暂时不可用，请重新打开 omni。" }
}

export async function pasteImages(
  items: DataTransferItemList | null,
  enabled: boolean,
  bridge: Bridge | undefined,
): Promise<AttachmentResult> {
  const files = Array.from(items ?? []).filter((item) => item.kind === "file").map((item) => item.getAsFile())
  const review = reviewAttachments(files.map((file) => file ?? { type: "", size: 0 }))
  if (!enabled) return { paths: [], notice: dropNotice(review, false, 0, 0) }
  if (bridge === undefined) return unavailable()
  const accepted = files.filter((file): file is File => file !== null && canAttachImage(file))
  const stashed = await Promise.all(accepted.map(async (file) => {
    try {
      return await bridge.stashImage(file.type, await file.arrayBuffer())
    } catch {
      return undefined
    }
  }))
  const paths = stashed.filter((path): path is string => path !== undefined)
  return { paths, notice: dropNotice(review, true, paths.length, accepted.length - paths.length) }
}

export function droppedImages(
  list: FileList | null,
  enabled: boolean,
  bridge: Bridge | undefined,
): AttachmentResult {
  const files = Array.from(list ?? [])
  const review = reviewAttachments(files)
  if (!enabled) return { paths: [], notice: dropNotice(review, false, 0, 0) }
  if (bridge === undefined) return unavailable()
  const paths: string[] = []
  let failed = 0
  for (const file of files.filter(canAttachImage)) {
    try {
      const path = bridge.pathForFile(file)
      if (path === "") failed += 1
      else paths.push(path)
    } catch {
      failed += 1
    }
  }
  return { paths, notice: dropNotice(review, true, paths.length, failed) }
}

export async function pickedImages(bridge: Bridge | undefined): Promise<AttachmentResult> {
  if (bridge === undefined) return unavailable()
  try {
    const result = await bridge.pickImages()
    if (result.canceled) return { paths: [] }
    if (result.rejected === 0) return { paths: result.paths }
    const added = result.paths.length
    const notice = added > 0
      ? `已添加 ${String(added)} 张；另有 ${String(result.rejected)} 个文件未添加。`
      : "未添加：图片为空、超过 12 MB，或格式不受支持。"
    return { paths: result.paths, notice }
  } catch {
    return unavailable()
  }
}
