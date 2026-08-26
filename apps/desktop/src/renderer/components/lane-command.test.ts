import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { LaneCommandBlock, LaneOutput } from "./lane-command.js"

describe("后台活动的可滚动原文", () => {
  it("命令和输出都能进入键盘焦点并说明滚动方向", () => {
    const command = renderToStaticMarkup(createElement(LaneCommandBlock, {
      command: "pnpm check",
      onCopy: () => undefined,
    }))
    const output = renderToStaticMarkup(createElement(LaneOutput, { text: "BUILD SUCCESS" }))

    expect(command).toContain('tabindex="0"')
    expect(command).toContain('aria-label="可横向滚动的后台命令"')
    expect(command).toContain('data-state="idle"')
    expect(command).toContain('class="lane-cmd-block__toolbar"')
    expect(command).toContain('aria-live="polite"')
    expect(command).toContain('title="复制后台命令"')
    expect(output).toContain('tabindex="0"')
    expect(output).toContain('aria-label="可滚动的后台输出"')
  })
})
