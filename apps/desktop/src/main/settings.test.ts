import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SETTINGS_DEFAULTS } from "../shared/settings.js"

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

  // **比的是 `SETTINGS_DEFAULTS` 本身，不再手抄一份。** 手抄那份每加一个偏好就红一次，
  // 而它红的时候什么也没说明——「新字段没抄进测试」不是 bug。真正要钉的那一条在下面
  it("没有文件时用默认值，不报错——第一次启动是常态", () => {
    expect(createSettings(log).get()).toEqual(SETTINGS_DEFAULTS)
  })

  // **远程默认整个关着。** 这一条单独写死：它是一个把服务端打开的开关，
  // 哪天默认值被改成 true 而没人注意到，用户升级一次就凭空多了一个监听端口。
  // 和上面那条分开是有意的——上面比「读出来的 == 默认值」，这里比「默认值本身是什么」
  it("远程默认整个关着——这一条不能跟着默认值一起变", () => {
    expect(SETTINGS_DEFAULTS.remote).toEqual({
      enabled: false,
      port: 17800,
      trustedHosts: [],
      maxTrust: "auto-edit",
    })
  })

  describe("DSH 接入确认", () => {
    const write = (dsh: unknown): void => {
      writeFileSync(file(), JSON.stringify({ dsh }), "utf8")
    }

    it("默认不接入——没有配置时 DSH 不能凭一次 ACP 握手出现在引擎清单", () => {
      expect(SETTINGS_DEFAULTS.dsh).toEqual({ configured: false })
    })

    it("只认字面的 true，坏值与旧设置都落回未配置", () => {
      for (const bad of ["true", 1, "yes", {}, null]) {
        write({ configured: bad })
        expect(createSettings(log).get().dsh.configured).toBe(false)
      }
      write({ configured: true })
      expect(createSettings(log).get().dsh.configured).toBe(true)
    })
  })

  describe("远程那几项", () => {
    const write = (remote: unknown): void => {
      writeFileSync(file(), JSON.stringify({ remote }), "utf8")
    }

    it("**`enabled` 只认字面的 true**——坏值不该被当成「开」", () => {
      for (const bad of ["true", 1, "yes", {}]) {
        write({ enabled: bad })
        expect(createSettings(log).get().remote.enabled).toBe(false)
      }
      write({ enabled: true })
      expect(createSettings(log).get().remote.enabled).toBe(true)
    })

    /** 归一之后的 trustedHosts。 */
    const hosts = (raw: unknown): readonly string[] => {
      write({ enabled: true, trustedHosts: raw })
      return createSettings(log).get().remote.trustedHosts
    }

    it("**粘一整个 `https://host:port` 也认**——那一串正是人在手机上打开的地址，粘进来带 scheme 是最自然的动作，不是打错", () => {
      expect(hosts(["https://omni.example.com:8443"])).toEqual(["omni.example.com:8443"])
    })

    it("http 的、末尾带斜杠的、前后带空格的，一样收", () => {
      expect(hosts(["http://omni.example.com/", "  https://a.b:1  "])).toEqual([
        "omni.example.com",
        "a.b:1",
      ])
    })

    it("裸的原样不动", () => {
      expect(hosts(["omni.example.com:8443"])).toEqual(["omni.example.com:8443"])
    })

    it("**带路径的不猜**——`host/path` 会把整个主机名授权出去，而人以为只授权了那条路径。留给启动时大声失败", () => {
      expect(hosts(["https://omni.example.com/path"])).toEqual(["https://omni.example.com/path"])
    })

    it("**档位认不出就回默认，绝不落到最宽的那一档**", () => {
      write({ maxTrust: "sudo" })
      expect(createSettings(log).get().remote.maxTrust).toBe("auto-edit")
      write({ maxTrust: "read-only" })
      expect(createSettings(log).get().remote.maxTrust).toBe("read-only")
    })

    it("端口要是合法整数，越界或小数回默认", () => {
      for (const bad of [-1, 70000, 3.5, "8080", null]) {
        write({ port: bad })
        expect(createSettings(log).get().remote.port).toBe(17800)
      }
      write({ port: 0 })
      expect(createSettings(log).get().remote.port).toBe(0)
    })

    it("trustedHosts 只留字符串", () => {
      write({ trustedHosts: ["a.example.com", 3, null, "b.example.com"] })
      expect(createSettings(log).get().remote.trustedHosts).toEqual([
        "a.example.com",
        "b.example.com",
      ])
    })

    it("整个 remote 段是坏的就回默认，不掀翻别的偏好", () => {
      writeFileSync(file(), JSON.stringify({ theme: "dark", remote: "开" }), "utf8")
      const settings = createSettings(log).get()
      expect(settings.remote.enabled).toBe(false)
      expect(settings.theme).toBe("dark")
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
