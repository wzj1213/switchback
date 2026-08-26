import { stat } from "node:fs/promises"
import { pickedFile, type PickedFile, type PickedFiles } from "../shared/attachments.js"

/** 核验系统选择器回来的路径，并只把用户真实选中的现存文件登记给缩略图通道。 */
export async function pickedFilesOf(
  paths: readonly string[],
  allow: (paths: readonly string[]) => void,
): Promise<PickedFiles> {
  const selected = await Promise.all(paths.map(async (path) => {
    const info = await stat(path).catch(() => undefined)
    return pickedFile(path, info?.size ?? 0, info?.isFile() === true)
  }))
  const files = selected.filter((file): file is PickedFile => file !== undefined)
  allow(files.map((file) => file.path))
  return { files, failed: selected.length - files.length, canceled: false }
}
