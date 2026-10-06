import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { pickedFilesOf } from "./picked-files.js"

describe("系统选择文件核验", () => {
  it("保留图片和普通文件、排除已消失路径，并只登记有效选择", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchback-picked-files-"))
    try {
      const image = join(root, "shot.PNG"), source = join(root, "main.ts"), gone = join(root, "gone.pdf")
      await Promise.all([writeFile(image, "png"), writeFile(source, "export {}")])
      const allowed: string[][] = []
      expect(await pickedFilesOf([image, source, gone], (paths) => { allowed.push([...paths]) })).toEqual({
        files: [{ path: image, image: true }, { path: source, image: false }], failed: 1, canceled: false,
      })
      expect(allowed).toEqual([[image, source]])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
