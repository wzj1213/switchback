import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { parseDiff } from "../diff.js"
import { numbered } from "../review-lines.js"
import { ReviewDiff } from "./ReviewDiff.js"
import { Tools } from "./ReviewTools.js"

const PATCH = [
  "@@ -1,3 +1,3 @@ function f() {",
  " const keep = 1",
  "-const openable = new Set(rows)",
  "+const lastAnswerAt = new Set(rows)",
].join("\n")

function render(split: boolean, path = "x.ts"): string {
  return renderToStaticMarkup(
    createElement(ReviewDiff, {
      lines: numbered(parseDiff(PATCH, "update")),
      path,
      split,
      loading: false,
    }),
  )
}

/**
 * 并排原来只渲染行号 + 正文，于是「这行是加的还是删的」**只有颜色一个信号**——
 * 而那层 12% 的底色压在纸上只有 1.18:1、深色下 1.21:1。
 * 底色本来就不必过 AA，问题是它是唯一的信号，而它偏偏用红/绿承担。
 */
describe("ReviewDiff · 增删信号", () => {
  it("并排两侧各有记号列，不是只有底色", () => {
    const html = render(true)
    expect(html).toContain('class="rvd__cell rvd__line--del"')
    expect(html).toContain('class="rvd__cell rvd__line--add"')
    // 单栏一直有记号列，并排是自己漏掉的那一半——不是一个新设计
    expect(html.match(/rvd__sign/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(html).toContain("−")
    expect(html).toContain("+")
  })

  it("单栏三个行号槽都在：宽窄由容器查询挑，DOM 不跟着变", () => {
    const html = render(false)
    expect(html).toContain("rvd__n--old")
    expect(html).toContain("rvd__n--new")
    expect(html).toContain("rvd__n--one")
  })

  it("并排每侧只画一个号，用的是同一个 `--one` 槽", () => {
    const html = render(true)
    expect(html).toContain("rvd__n--one")
    expect(html).not.toContain("rvd__n--old")
  })
})

describe("ReviewDiff · 补丁上色", () => {
  it("语法着色和词级高亮都落到 DOM 上，两套类叠在同一截字上", () => {
    const html = render(false)
    expect(html).toContain("hljs-keyword")
    expect(html).toContain("rvd__hit")
  })

  it("取不到语言时只剩词级高亮，不硬猜一种语言染上去", () => {
    const html = render(false, "Makefile")
    expect(html).not.toContain("hljs-")
    expect(html).toContain("rvd__hit")
  })

  it("正文一字不差地还原——切错偏移会静默吞字，而没人会去数", () => {
    expect(render(false)).toContain("lastAnswerAt")
    expect(render(true)).toContain("openable")
  })
})

/**
 * 窄面板下并排不可用。**按钮置灰而不是消失**——消失了没人知道并排去哪了，
 * 下次拉宽也不会想起来还有这个功能。
 */
describe("Tools · 并排闸门", () => {
  function tools(split: boolean, narrow: boolean): string {
    return renderToStaticMarkup(
      createElement(Tools, {
        split, narrow, context: 3, list: true, files: [], active: undefined,
        onSplit: () => undefined, onContext: () => undefined, onReload: () => undefined,
        onList: () => undefined, onPick: () => undefined,
      }),
    )
  }

  /** 只看并排那一颗。整条工具栏里别的键也有 `aria-pressed`，扫全串会读错。 */
  function splitBtn(html: string): string {
    return /<button[^>]*(?:切换到|放不下两列)[^>]*>/.exec(html)?.[0] ?? ""
  }

  it("宽的时候照常可点，按下去是「已经在并排」", () => {
    const btn = splitBtn(tools(true, false))
    expect(btn).toContain('aria-pressed="true"')
    expect(btn).not.toContain("disabled")
  })

  it("窄的时候置灰，并把理由写在提示里——不是默默变成不可点", () => {
    const btn = splitBtn(tools(true, true))
    expect(btn).toContain("disabled")
    expect(btn).toContain("收起文件清单或展开面板")
  })

  it("**窄的时候按钮不显示成按下态**：那一刻屏幕上是单栏，按钮不能说反话", () => {
    expect(splitBtn(tools(true, true))).toContain('aria-pressed="false"')
  })
})
