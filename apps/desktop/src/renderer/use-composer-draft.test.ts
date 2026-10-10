import { describe, expect, it } from "vitest"
import { mergeDraft } from "./use-composer-draft.js"

describe("交回的话并进输入框，不盖掉正写着的", () => {
  const cases: readonly { name: string; current: string; incoming: string; lead?: boolean; want: string }[] = [
    { name: "输入框空着：就是交回的那句", current: "", incoming: "取回的那句", want: "取回的那句" },
    { name: "只有空白也算空着", current: "  \n", incoming: "取回的那句", want: "取回的那句" },
    { name: "正写着东西：另起一行接在后面", current: "正在写的第二句", incoming: "排队的第一句", want: "正在写的第二句\n排队的第一句" },
    { name: "结尾的空行不叠", current: "正在写的\n\n", incoming: "接上", want: "正在写的\n接上" },
    { name: "问一句：引文放在前面，原来的话当成问题", current: "这里为什么这样？", incoming: "关于「某句话」：", lead: true, want: "关于「某句话」：这里为什么这样？" },
    { name: "交回的是空话：原样不动", current: "正在写", incoming: "", want: "正在写" },
  ]
  for (const one of cases) {
    it(one.name, () => {
      expect(mergeDraft(one.current, one.incoming, one.lead === true)).toBe(one.want)
    })
  }
})
