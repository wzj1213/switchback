import { rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

/** 视觉场景临时制造真实磁盘变化；wx 保证不会覆盖工作区里已有的文件。 */
export async function prepareWorkspaceFiles(root, view, created) {
  for (const path of view.createFiles ?? []) {
    const absolute = join(root, path)
    await writeFile(absolute, "// omni visual refresh probe\n", { flag: "wx" })
    created.add(absolute)
  }
  for (const file of view.rewriteFiles ?? []) {
    const absolute = join(root, file.path)
    if (!created.has(absolute)) throw new Error(`拒绝改写真正的工作区文件：${file.path}`)
    await writeFile(absolute, file.text)
  }
}

export async function cleanupWorkspaceFiles(created) {
  for (const path of created) await rm(path, { force: true })
}
