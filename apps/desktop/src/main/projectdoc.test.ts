import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ensureProjectDoc, projectDoc } from "./projectdoc.js"

describe("项目说明工作区边界", () => {
  it("只为真实 thread/cwd 配对读写，拒绝请求不会碰磁盘", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "omni-projectdoc-"))
    const owns = (threadId: string, candidate: string): boolean => threadId === "th-1" && candidate === cwd
    try {
      const forbidden = [
        undefined,
        { threadId: "", cwd },
        { threadId: "other", cwd },
        { threadId: "th-1", cwd: "/" },
      ]
      for (const request of forbidden) {
        await expect(ensureProjectDoc(request, owns)).resolves.toMatchObject({ denied: true, path: "" })
      }
      await expect(access(join(cwd, "AGENTS.md"))).rejects.toBeDefined()
      await expect(ensureProjectDoc({ threadId: "th-1", cwd }, owns)).resolves.toMatchObject({
        agents: true,
        claude: true,
        linked: true,
        path: join(cwd, "AGENTS.md"),
      })
      await writeFile(join(cwd, "CLAUDE.md"), "用户自己的说明\n", "utf8")
      await ensureProjectDoc({ threadId: "th-1", cwd }, owns)
      await expect(readFile(join(cwd, "CLAUDE.md"), "utf8")).resolves.toBe("用户自己的说明\n")
      await expect(projectDoc({ threadId: "other", cwd }, owns)).resolves.toMatchObject({ denied: true })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
