import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadImages, mimeOfImage } from "./image.js"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("引擎内联图片", () => {
  it("保序并行读出受支持图片", async () => {
    const dir = await mkdtemp(join(tmpdir(), "omni-image-"))
    dirs.push(dir)
    const first = join(dir, "A.PNG")
    const second = join(dir, "b.jpg")
    await Promise.all([writeFile(first, "one"), writeFile(second, "two")])
    const loaded = await loadImages([first, second])
    expect(loaded.map((image) => [image.path, image.mime, image.data.toString()])).toEqual([
      [first, "image/png", "one"],
      [second, "image/jpeg", "two"],
    ])
  })

  it("格式不支持或文件丢失时明确拒绝，不静默少送", async () => {
    expect(mimeOfImage("x.svg")).toBeUndefined()
    await expect(loadImages(["/definitely/missing.png"])).rejects.toThrow("附件读不到")
    await expect(loadImages(["/tmp/unsupported.heic"])).rejects.toThrow("不支持的图片格式")
  })
})
