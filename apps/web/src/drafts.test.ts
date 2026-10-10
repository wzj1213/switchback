import { describe, expect, it } from "vitest"
import { clearDrafts, MAX_WEB_DRAFTS, readDraft, writeDraft, type DraftStorage } from "./drafts.js"

function memory(): DraftStorage & { raw: Map<string, string> } {
  const raw = new Map<string, string>()
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => { raw.set(key, value) },
    removeItem: (key) => { raw.delete(key) },
  }
}

describe("手机上的草稿", () => {
  it("按会话存、按会话读", () => {
    const storage = memory()
    writeDraft(storage, "a", { text: "A 里打的" }, 1)
    writeDraft(storage, "b", { text: "B 里打的" }, 2)
    expect(readDraft(storage, "a")?.text).toBe("A 里打的")
    expect(readDraft(storage, "b")?.text).toBe("B 里打的")
  })

  const cases = [
    { name: "写空就是删", draft: { text: "" }, want: undefined },
    { name: "字删光了但并过一版宿主草稿：记着，不然重载后删掉的字又回来", draft: { text: "", applied: "dr-1" }, want: { text: "", applied: "dr-1", at: 3 } },
  ]
  for (const c of cases) {
    it(c.name, () => {
      const storage = memory()
      writeDraft(storage, "a", { text: "旧的" }, 1)
      writeDraft(storage, "a", c.draft, 3)
      expect(readDraft(storage, "a")).toEqual(c.want)
    })
  }

  it("只留最近的那些；解除配对一起清", () => {
    const storage = memory()
    for (let i = 0; i <= MAX_WEB_DRAFTS; i += 1) writeDraft(storage, `t${String(i)}`, { text: "x" }, i)
    expect(readDraft(storage, "t0")).toBeUndefined()
    expect(readDraft(storage, `t${String(MAX_WEB_DRAFTS)}`)).toBeDefined()
    clearDrafts(storage)
    expect(storage.raw.size).toBe(0)
  })

  it("盘上是坏的：当没有，不白屏", () => {
    const storage = memory()
    storage.setItem("switchback:drafts", "{坏")
    expect(readDraft(storage, "a")).toBeUndefined()
  })
})
