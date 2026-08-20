import { describe, expect, it } from "vitest"
import { createQueue } from "./queue.js"

describe("异步输入队列", () => {
  it("关闭后明确拒绝新消息，不把未送达伪装成 push 成功", () => {
    const queue = createQueue<string>()
    expect(queue.push("第一句")).toBe(true)
    queue.close()
    expect(queue.push("不会送达")).toBe(false)
  })
})
