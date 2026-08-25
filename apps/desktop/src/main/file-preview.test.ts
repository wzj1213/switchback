import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { previewFile } from "./file-preview.js"

describe("文件预览边界", () => {
  it("读取工作区文本与 HTML，拒绝越界、符号链接越界和二进制", async () => {
    const root = await mkdtemp(join(tmpdir(), "omni-preview-root-"))
    const outside = await mkdtemp(join(tmpdir(), "omni-preview-outside-"))
    try {
      await writeFile(join(root, "page.html"), "<h1>预览</h1>")
      await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]))
      await writeFile(join(outside, "secret.txt"), "outside")
      await symlink(join(outside, "secret.txt"), join(root, "linked.txt"))

      await expect(previewFile({ cwd: root, path: "page.html" })).resolves.toMatchObject({
        kind: "html",
        text: "<h1>预览</h1>",
        truncated: false,
      })
      await expect(previewFile({ cwd: root, path: "../secret.txt" })).resolves.toMatchObject({
        kind: "unavailable",
        reason: "outside",
      })
      await expect(previewFile({ cwd: root, path: "linked.txt" })).resolves.toMatchObject({
        kind: "unavailable",
        reason: "outside",
      })
      await expect(previewFile({ cwd: root, path: "binary.bin" })).resolves.toMatchObject({
        kind: "unavailable",
        reason: "binary",
      })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
