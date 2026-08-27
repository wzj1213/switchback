import { describe, expect, it } from "vitest"
import type { ReviewFile } from "../shared/review.js"
import { parseDiff } from "./diff.js"
import { filterFiles, numbered, reviewCopyText, splitRows, tallyReview, trimMeta } from "./review.js"
import { blank } from "./components/review-empty.js"

const PATCH = [
  "diff --git a/x.ts b/x.ts",
  "index 111..222 100644",
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ -10,4 +10,5 @@ function f() {",
  " keep one",
  "-old line",
  "+new line",
  "+extra line",
  " keep two",
  "@@ -40,3 +41,3 @@ function g() {",
  " far one",
  "-gone",
  "+here",
].join("\n")

const lines = (): ReturnType<typeof numbered> => numbered(parseDiff(PATCH, "update"))

/**
 * 行号是审核面板存在的一半理由：看到一处可疑的改动，下一步就是去编辑器里打开那一行。
 * **算错的行号比没有行号更坏**——人会照着它去找，找到的是别的地方。
 */
describe("numbered", () => {
  it("上下文行两侧都有号，增行只有新号，删行只有旧号", () => {
    const out = lines()
    const keep = out.find((l) => l.text === "keep one")
    expect(keep?.old).toBe(10)
    expect(keep?.new).toBe(10)
    const del = out.find((l) => l.text === "old line")
    expect(del?.old).toBe(11)
    expect(del?.new).toBeUndefined()
    const add = out.find((l) => l.text === "new line")
    expect(add?.new).toBe(11)
    expect(add?.old).toBeUndefined()
  })

  it("增行比删行多的时候，新号继续往下走", () => {
    expect(lines().find((l) => l.text === "extra line")?.new).toBe(12)
  })

  it("删增之后的上下文行，两侧的号已经错开了", () => {
    const keep = lines().find((l) => l.text === "keep two")
    expect(keep?.old).toBe(12)
    expect(keep?.new).toBe(13)
  })

  it("**第二个 hunk 从它自己的头开始重数**，不是接着上一个", () => {
    const far = lines().find((l) => l.text === "far one")
    expect(far?.old).toBe(40)
    expect(far?.new).toBe(41)
  })

  it("文件头和 hunk 头不占行号", () => {
    for (const l of lines().filter((x) => x.kind === "meta" || x.kind === "hunk")) {
      expect(l.old).toBeUndefined()
      expect(l.new).toBeUndefined()
    }
  })
})

/**
 * 并排是从 unified 拼出来的。配错了不报错，只会让人对着两列错位的代码看半天。
 */
describe("splitRows", () => {
  it("一删一增配成同一行的左右两侧", () => {
    const rows = splitRows(lines())
    const paired = rows.find((r) => r.left?.text === "old line")
    expect(paired?.right?.text).toBe("new line")
  })

  it("增比删多的那几行，左侧留空——不是错位到下一行去", () => {
    const rows = splitRows(lines())
    const extra = rows.find((r) => r.right?.text === "extra line")
    expect(extra?.left).toBeUndefined()
  })

  it("上下文行两侧放同一行", () => {
    const rows = splitRows(lines())
    const ctx = rows.find((r) => r.left?.text === "keep one")
    expect(ctx?.right?.text).toBe("keep one")
  })

  it("hunk 头横跨两列", () => {
    const rows = splitRows(lines())
    expect(rows.some((r) => r.full?.kind === "hunk")).toBe(true)
  })

  it("补丁末尾正好是一段增删时也要收干净——最后一段不 drain 就整个丢了", () => {
    const rows = splitRows(lines())
    expect(rows.some((r) => r.right?.text === "here")).toBe(true)
    expect(rows.some((r) => r.left?.text === "gone")).toBe(true)
  })
})

const file = (rel: string, added = 1, removed = 0): ReviewFile => ({
  path: `/w/${rel}`,
  rel,
  kind: "update",
  added,
  removed,
})

describe("filterFiles", () => {
  it("匹配整条路径，不只是文件名——按目录筛是审核时最常做的动作", () => {
    const files = [file("src/main/a.ts"), file("src/renderer/b.ts"), file("docs/c.md")]
    expect(filterFiles(files, "src/main").map((f) => f.rel)).toEqual(["src/main/a.ts"])
  })

  it("不分大小写，空查询原样返回", () => {
    const files = [file("src/Main.ts")]
    expect(filterFiles(files, "main")).toHaveLength(1)
    expect(filterFiles(files, "   ")).toEqual(files)
  })
})

describe("tallyReview", () => {
  it("合计增删", () => {
    expect(tallyReview([file("a", 3, 1), file("b", 2, 5)])).toEqual({ added: 5, removed: 6 })
  })
})

describe("reviewCopyText", () => {
  it("有补丁时复制真实补丁，没有正文时复制路径和明确原因", () => {
    expect(reviewCopyText("src/a.ts", { patch: "@@ -1 +1 @@", added: 1, removed: 1 }))
      .toBe("@@ -1 +1 @@")
    expect(reviewCopyText("asset.bin", { patch: "", skip: "binary", added: 0, removed: 0 }))
      .toBe("asset.bin\n\n（二进制文件不提供文本补丁）")
    expect(reviewCopyText("gone.ts", { patch: "", skip: "gone", added: 0, removed: 1 }))
      .toContain("文件已不存在")
    expect(reviewCopyText("same.ts", { patch: "", added: 0, removed: 0 }))
      .toContain("没有可复制的净改动")
  })
})

/**
 * 三种「右边是空的」原因完全不同，说同一句话等于什么都没说：
 * 不是仓库（没法比）、干净（没得审）、筛没了（改筛选词）。
 */
describe("空状态的措辞", () => {
  it("四种情况各说各的", () => {
    expect(blank({ noRepo: false, loading: true, total: 0, shown: 0 })).toContain("正在问")
    expect(blank({ noRepo: true, total: 0, shown: 0 })).toContain("不是 git 仓库")
    expect(blank({ noRepo: false, total: 0, shown: 0 })).toContain("干净")
    expect(blank({ noRepo: false, total: 5, shown: 0 })).toContain("筛选")
    expect(blank({ noRepo: false, total: 8, shown: 0, more: 3 })).toContain("3 个文件未载入")
    expect(blank({ noRepo: false, total: 5, shown: 5 })).toContain("选一个")
  })

  it("加载中压过其余三种——那时还不知道是哪一种", () => {
    expect(blank({ noRepo: true, loading: true, total: 0, shown: 0 })).toContain("正在问")
  })

  it("只有 Git 忽略文件时不冒充本次对话没有改动", () => {
    const message = blank({ noRepo: false, baseline: true, total: 0, shown: 0, unverified: 2 })
    expect(message).toContain("2 个 Git 忽略文件")
    expect(message).toContain("无法核实")
    expect(message).not.toContain("没有净改动")
  })

  it("旧会话缺少开场基线时明确说明只能比较 HEAD", () => {
    const message = blank({ noRepo: false, baseline: false, total: 0, shown: 0 })
    expect(message).toContain("没有可用的开场基线")
    expect(message).toContain("相对 HEAD")
    expect(message).toContain("无法还原本次对话净改动")
  })
})

/**
 * 文件头那四行在审核面板里是纯噪音：路径写在正文上方，blob 哈希对读代码没帮助，
 * 而每个文件开头顶四行灰字，第一处真正的改动就被推下去了。
 */
describe("trimMeta", () => {
  it("丢掉 diff --git / index / --- / +++，留下 hunk 头和内容", () => {
    const out = trimMeta(lines())
    expect(out.some((l) => l.kind === "meta")).toBe(false)
    expect(out.some((l) => l.kind === "hunk")).toBe(true)
    expect(out.some((l) => l.text === "new line")).toBe(true)
  })

  it("丢完之后行号还是对的——行号在丢之前就算好了", () => {
    expect(trimMeta(lines()).find((l) => l.text === "old line")?.old).toBe(11)
  })

  it("模式变化与无换行标记保留为无行号元数据，不冒充第 0 行正文", () => {
    const patch = [
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
      "\\ No newline at end of file",
    ].join("\n")
    const out = trimMeta(numbered(parseDiff(patch, "update")))
    expect(out.map((line) => line.text)).toEqual([
      "old mode 100644",
      "new mode 100755",
      "\\ No newline at end of file",
    ])
    expect(out.every((line) => line.kind === "meta" && line.old === undefined && line.new === undefined)).toBe(true)
  })
})

