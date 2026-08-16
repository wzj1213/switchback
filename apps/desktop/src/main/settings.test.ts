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
      pinned: [],
      defaultEngine: "",
      defaultTrust: "auto-edit",
      projectIcons: {},
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
