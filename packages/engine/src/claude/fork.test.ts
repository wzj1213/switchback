import { describe, expect, it } from "vitest"
import { cutAt } from "./fork.js"

type Entry = Record<string, unknown>

/** 一句人话——**一轮的开头**。 */
const said = (uuid: string, text: string): Entry => ({
  type: "user",
  uuid,
  message: { content: text },
})
/** 模型答的一段。 */
const said2 = (uuid: string, text: string): Entry => ({
  type: "assistant",
  uuid,
  message: { content: [{ type: "text", text }] },
})
/** 工具结果。**也是 `type:"user"`，但它不是人打的，不开轮。** */
const result = (uuid: string, id: string): Entry => ({
  type: "user",
  uuid,
  message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
})

/** 三轮，每轮「人说一句 → 模型答一段」。 */
const THREE: readonly Entry[] = [
  said("u1", "第一句"),
  said2("a1", "答一"),
  said("u2", "第二句"),
  said2("a2", "答二"),
  said("u3", "第三句"),
  said2("a3", "答三"),
]

describe("cutAt", () => {
  const cases: readonly { name: string; entries: readonly Entry[]; drop: number; want: string | undefined }[] = [
    {
      name: "砍掉最后一轮：落点是第二轮的最后一条",
      entries: THREE,
      drop: 1,
      want: "a2",
    },
    {
      name: "砍掉最后两轮：落点退到第一轮的最后一条",
      entries: THREE,
      drop: 2,
      want: "a1",
    },
    {
      name: "**一轮都不留不算分叉**：那时调用方该开空白分支，不该走这条路",
      entries: THREE,
      drop: 3,
      want: undefined,
    },
    {
      name: "要丢的比现有的还多，一样答不出来",
      entries: THREE,
      drop: 9,
      want: undefined,
    },
    { name: "不丢就没有落点——整条复制", entries: THREE, drop: 0, want: undefined },
    { name: "空会话答不出来", entries: [], drop: 1, want: undefined },
    {
      name: "**工具结果不开轮**：它也是 type:user，但不是人打的",
      entries: [
        said("u1", "第一句"),
        said2("a1", "我查一下"),
        result("r1", "tool-1"),
        said2("a2", "查完了"),
        said("u2", "第二句"),
        said2("a3", "答二"),
      ],
      drop: 1,
      // 第一轮的尾巴是 `a2`（工具往返之后那段），不是 `a1`
      want: "a2",
    },
    {
      name: "落点取**留下那一轮的最后一条**，哪怕它是个工具结果",
      entries: [
        said("u1", "第一句"),
        said2("a1", "我查一下"),
        result("r1", "tool-1"),
        said("u2", "第二句"),
      ],
      drop: 1,
      want: "r1",
    },
    {
      name: "没有 uuid 的元数据行跳过，往前找到真正的 chain entry",
      entries: [
        said("u1", "第一句"),
        said2("a1", "答一"),
        { type: "summary", summary: "标题" },
        said("u2", "第二句"),
      ],
      drop: 1,
      want: "a1",
    },
    {
      name: "子 agent 的往来不开轮（isSidechain）",
      entries: [
        said("u1", "第一句"),
        { type: "user", uuid: "s1", isSidechain: true, message: { content: "子 agent 在说话" } },
        said2("a1", "答一"),
        said("u2", "第二句"),
      ],
      drop: 1,
      want: "a1",
    },
    {
      name: "压缩摘要不开轮（isCompactSummary）——它不是人打的",
      entries: [
        said("u1", "第一句"),
        { type: "user", uuid: "c1", isCompactSummary: true, message: { content: "前情提要……" } },
        said2("a1", "答一"),
        said("u2", "第二句"),
      ],
      drop: 1,
      want: "a1",
    },
  ]

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, one) => {
    expect(cutAt(one.entries, one.drop)).toBe(one.want)
  })
})
