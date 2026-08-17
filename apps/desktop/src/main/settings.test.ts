import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const dir = { path: mkdtempSync(join(tmpdir(), "omni-settings-")) }
const theme = { source: "system" }

vi.mock("electron", () => ({
  app: { getPath: () => dir.path },
  ipcMain: { handle: vi.fn() },
  nativeTheme: {
    get themeSource() {
      return theme.source
    },
    set themeSource(next: string) {
      theme.source = next
    },
  },
}))

const { createSettings } = await import("./settings.js")

const log = { file: "x", write: () => undefined }
const file = (): string => join(dir.path, "settings.json")

describe("偏好", () => {
  beforeEach(() => {
    dir.path = mkdtempSync(join(tmpdir(), "omni-settings-"))
    theme.source = "system"
  })

  it("没有文件时用默认值，不报错——第一次启动是常态", () => {
    expect(createSettings(log).get()).toEqual({
      theme: "system",
      projects: [],
      pinned: [],
      pinnedThreads: [],
      threadOrder: {},
      defaultEngine: "",
      defaultTrust: "auto-edit",
      projectIcons: {},
      lastUsed: { engine: "", byEngine: {} },
    })
  })

  it("写入之后落盘，再读回来还在", () => {
    const store = createSettings(log)
    store.patch({ pinned: ["/w/omni"], theme: "dark" })
    expect(JSON.parse(readFileSync(file(), "utf8")) as unknown).toMatchObject({
      pinned: ["/w/omni"],
      theme: "dark",
    })
    expect(createSettings(log).get().pinned).toEqual(["/w/omni"])
  })

  it("**认不出的信任档回落到默认**——查不到的档位在判定器里会落到最宽那一档，那是安全问题", () => {
    writeFileSync(file(), JSON.stringify({ defaultTrust: "随便写的" }), "utf8")
    expect(createSettings(log).get().defaultTrust).toBe("auto-edit")
  })

  it("认不出的主题也回落，不会把 nativeTheme 设成一个非法值", () => {
    writeFileSync(file(), JSON.stringify({ theme: "霓虹" }), "utf8")
    expect(createSettings(log).get().theme).toBe("system")
    expect(theme.source).toBe("system")
  })

  it("pinned 里的非字符串滤掉——JSON 里塞个数字不该变成一个路径", () => {
    writeFileSync(file(), JSON.stringify({ pinned: ["/w/a", 7, null, "/w/b"] }), "utf8")
    expect(createSettings(log).get().pinned).toEqual(["/w/a", "/w/b"])
  })

  it("文件坏了也用默认值起得来", () => {
    writeFileSync(file(), "{ 这不是 JSON", "utf8")
    expect(createSettings(log).get().theme).toBe("system")
  })

  it("patch 是合并不是替换——只改主题不该把置顶清空", () => {
    const store = createSettings(log)
    store.patch({ pinned: ["/w/omni"] })
    expect(store.patch({ theme: "light" }).pinned).toEqual(["/w/omni"])
  })

  it("改主题会同步到 nativeTheme，否则设置里选了深色但窗口没变", () => {
    createSettings(log).patch({ theme: "dark" })
    expect(theme.source).toBe("dark")
  })
})

describe("项目图标", () => {
  /** 偏好文件是**可以手改的**，所以这些用例走「文件里写什么 → 读出来是什么」。 */
  const readBack = (icons: unknown): Record<string, string> => {
    writeFileSync(file(), JSON.stringify({ projectIcons: icons }))
    return createSettings(log).get().projectIcons as Record<string, string>
  }

  it("路径 → emoji 原样收下", () => {
    expect(readBack({ "/w/a": "🟦" })).toEqual({ "/w/a": "🟦" })
  })

  it("带修饰符的 emoji（肤色、ZWJ 组合）也收——一个字素装不下它们", () => {
    expect(readBack({ "/w/a": "👩‍💻" })["/w/a"]).toBe("👩‍💻")
  })

  it("**超长的一律丢掉**：偏好文件可以手改，而侧栏那一列宽度固定", () => {
    expect(readBack({ "/w/a": "这是一段很长的文字会把整列撑垮" })).toEqual({})
  })

  it("空串、非字符串都丢掉", () => {
    expect(readBack({ "/w/a": "", "/w/b": 42 })).toEqual({})
  })

  it("整个字段不是对象时给空表，不炸", () => {
    expect(readBack("坏了")).toEqual({})
  })
})

describe("拖动排序存下来的那两项", () => {
  /** 直接写偏好文件——这几项现在只有界面会写，但文件是用户能手改的。 */
  const write = (raw: unknown): void => {
    dir.path = mkdtempSync(join(tmpdir(), "omni-settings-"))
    writeFileSync(file(), JSON.stringify(raw), "utf8")
  }

  it("置顶的会话按写入顺序保留", () => {
    write({ pinnedThreads: ["th-b", "th-a"] })
    expect(createSettings(log).get().pinnedThreads).toEqual(["th-b", "th-a"])
  })

  it("**偏好文件是可以手改的**，混进别的类型要过滤掉", () => {
    write({ pinnedThreads: ["th-a", 42, null] })
    expect(createSettings(log).get().pinnedThreads).toEqual(["th-a"])
  })

  it("手动顺序按项目存", () => {
    write({ threadOrder: { "/w/one": ["b", "a"] } })
    expect(createSettings(log).get().threadOrder).toEqual({ "/w/one": ["b", "a"] })
  })

  it("**空数组的项直接丢掉**：「排过序但顺序是空的」没有意义，留着只多一个分支", () => {
    write({ threadOrder: { "/w/one": [], "/w/two": ["a"] } })
    expect(createSettings(log).get().threadOrder).toEqual({ "/w/two": ["a"] })
  })

  it("整项不是对象就当没有，不崩", () => {
    write({ threadOrder: "乱写的" })
    expect(createSettings(log).get().threadOrder).toEqual({})
  })

  /**
   * 这一段是**用户手改得到**的文件，而里面存的是「新会话开成什么样」。
   * 塞进去的脏东西如果被原样吃下，下一条新会话就开在一个不存在的模型上。
   */
  it("上次开工那一套：坏形状逐项丢掉，不是整份作废", () => {
    writeFileSync(
      file(),
      JSON.stringify({
        lastUsed: {
          engine: "codex",
          byEngine: {
            codex: { model: "gpt-5.3-codex", effort: "high" },
            claude: { model: 42 },
            kimi: "不是对象",
            空壳: {},
          },
        },
      }),
      "utf8",
    )
    expect(createSettings(log).get().lastUsed).toEqual({
      engine: "codex",
      byEngine: { codex: { model: "gpt-5.3-codex", effort: "high" } },
    })
  })

  it("lastUsed 整个是垃圾时回落到默认", () => {
    writeFileSync(file(), JSON.stringify({ lastUsed: "什么鬼" }), "utf8")
    expect(createSettings(log).get().lastUsed).toEqual({ engine: "", byEngine: {} })
  })
})
