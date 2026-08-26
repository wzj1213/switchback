import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { previewFile } from "./file-preview.js"

const nothing = (): boolean => false
const req = (cwd: string, path: string): { threadId: string; cwd: string; path: string } =>
  ({ threadId: "th-1", cwd, path })

describe("文件预览边界", () => {
  it("读取工作区文本与 HTML，拒绝越界、符号链接越界和二进制", async () => {
    const root = await mkdtemp(join(tmpdir(), "omni-preview-root-"))
    const outside = await mkdtemp(join(tmpdir(), "omni-preview-outside-"))
    try {
      await writeFile(join(root, "page.html"), "<h1>预览</h1>")
      await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]))
      await writeFile(join(outside, "secret.txt"), "outside")
      await symlink(join(outside, "secret.txt"), join(root, "linked.txt"))

      await expect(previewFile(req(root, "page.html"), nothing)).resolves.toMatchObject({
        kind: "html",
        text: "<h1>预览</h1>",
        truncated: false,
      })
      await expect(previewFile(req(root, "../secret.txt"), nothing)).resolves.toMatchObject({
        kind: "unavailable",
        reason: "outside",
      })
      await expect(previewFile(req(root, "linked.txt"), nothing)).resolves.toMatchObject({
        kind: "unavailable",
        reason: "outside",
      })
      await expect(previewFile(req(root, "binary.bin"), nothing)).resolves.toMatchObject({
        kind: "unavailable",
        reason: "binary",
      })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it("会话自己读过的文件，工作区外与符号链接外都照读；没读过的仍然挡住", async () => {
    const root = await mkdtemp(join(tmpdir(), "omni-preview-root-"))
    const outside = await mkdtemp(join(tmpdir(), "omni-preview-outside-"))
    try {
      const skill = join(outside, "SKILL.md")
      await writeFile(skill, "# 技能")
      await writeFile(join(outside, "secret.txt"), "没读过的")
      await symlink(join(outside, "secret.txt"), join(root, "linked.txt"))

      const noted = (_thread: string, _cwd: string, path: string): boolean => path === skill
      await expect(previewFile(req(root, skill), noted)).resolves.toMatchObject({
        kind: "text",
        text: "# 技能",
        language: "markdown",
      })
      await expect(previewFile(req(root, join(outside, "secret.txt")), noted)).resolves.toMatchObject({
        kind: "unavailable",
        reason: "outside",
      })
      await expect(previewFile(req(root, "linked.txt"), noted)).resolves.toMatchObject({
        kind: "unavailable",
        reason: "outside",
      })
      // 同一份文件，会话报过就连符号链接那条路也放行
      await expect(previewFile(req(root, "linked.txt"), () => true)).resolves.toMatchObject({
        kind: "text",
        text: "没读过的",
      })
      // 没有会话身份时只剩工作区那道门
      await expect(previewFile({ threadId: "", cwd: root, path: skill }, () => true)).resolves.toMatchObject({
        kind: "unavailable",
        reason: "outside",
      })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
