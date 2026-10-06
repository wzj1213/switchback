import { describe, expect, it } from "vitest"
import { adoptLegacy } from "./auth.js"

function storageOf(entries: Record<string, string>): Map<string, string> & Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const map = new Map(Object.entries(entries))
  return Object.assign(map, {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  })
}

describe("改名前的键挪到新键上", () => {
  const cases: readonly [string, Record<string, string>, Record<string, string>][] = [
    ["只有旧键：挪过来，旧的删掉", { "omni.token": "t1", "omni.device": "iPhone" }, { "switchback.token": "t1", "switchback.device": "iPhone" }],
    ["新旧都有：新的不动，旧的删掉", { "omni.token": "old", "switchback.token": "new" }, { "switchback.token": "new" }],
    ["只有新键：原样", { "switchback.token": "t2" }, { "switchback.token": "t2" }],
    ["都没有：什么也不写", {}, {}],
  ]
  for (const [name, before, after] of cases) {
    it(name, () => {
      const storage = storageOf(before)
      adoptLegacy(storage)
      expect(Object.fromEntries(storage)).toEqual(after)
    })
  }
})
