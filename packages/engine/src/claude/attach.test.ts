import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { toContent } from "./attach.js"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("Claude 图片消息", () => {
  it("附件在前、人话在后；纯图片不制造空文本块", async () => {
    const dir = await mkdtemp(join(tmpdir(), "switchback-claude-image-"))
    dirs.push(dir)
    const path = join(dir, "shot.png")
    await writeFile(path, "image")
    const withText = await toContent("看看", [path])
    expect(withText).toMatchObject([
      { type: "image", source: { media_type: "image/png" } },
      { type: "text", text: "看看" },
    ])
    expect(await toContent("", [path])).toHaveLength(1)
  })

  it("失败不会被改写成塞给模型的 Switchback 说明", async () => {
    await expect(toContent("仍然发文字", ["/missing.png"])).rejects.toThrow("附件读不到")
  })
})
