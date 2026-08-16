import { describe, expect, it } from "vitest"
import { expandHome, isAbsolute, isInside, normalize, resolve } from "./path.js"

describe("绝对路径判定", () => {
  it("POSIX", () => {
    expect(isAbsolute("/a/b")).toBe(true)
    expect(isAbsolute("a/b")).toBe(false)
  })

  it("**Windows 盘符**——不认的话它会被当成相对路径拼到工作区后面", () => {
    expect(isAbsolute("C:\\Users\\a")).toBe(true)
    expect(isAbsolute("c:/Users/a")).toBe(true)
  })

  it("UNC", () => {
    expect(isAbsolute("\\\\server\\share\\x")).toBe(true)
  })
})

describe("归一", () => {
  it("反斜杠先变正斜杠——Windows 上两种混用是常态", () => {
    expect(normalize("C:\\proj/src\\a.ts")).toBe("C:/proj/src/a.ts")
  })

  it("盘符留在最前面，不要变成 `/C:/…`", () => {
    expect(normalize("C:\\a\\..\\b")).toBe("C:/b")
  })

  it("POSIX 行为不变", () => {
    expect(normalize("/a/./b/../c")).toBe("/a/c")
    expect(normalize("a/b/../c")).toBe("a/c")
  })
})

describe("是否在工作区内", () => {
  /**
   * **这条不变量是这次 Windows 失效的根源，单独钉住。**
   *
   * 原来 `isInside("C:\\Users\\alice\\proj", "C:\\Users\\alice\\.aws\\credentials")`
   * 返回 true——因为后者被当成相对路径拼在了前者后面，字符串上「恰好」以它开头。
   * 所以判据不能只是「结果对不对」，而要是：**凡是判为在内的，
   * 归一之后必须真的以工作区开头，且下一个字符是分隔符。**
   */
  const 保证 = (parent: string, child: string): void => {
    if (!isInside(parent, child)) return
    const a = normalize(parent).replace(/\/+$/, "").toLowerCase()
    const b = normalize(child).toLowerCase()
    expect(b === a || b.startsWith(a + "/")).toBe(true)
  }

  it("判为「在内」的，归一之后必须真的以工作区开头", () => {
    const worksite = ["C:\\Users\\alice\\proj", "/Users/alice/proj"]
    const targets = [
      "C:\\Windows\\System32\\drivers\\etc\\hosts",
      "C:/Users/alice/.aws/credentials",
      "\\\\server\\share\\x",
      "/etc/passwd",
      "../../../etc/passwd",
      "src/a.ts",
      ".env",
    ]
    for (const w of worksite) for (const t of targets) 保证(w, resolve(w, t, "/Users/alice"))
  })

  it("Windows 上界外的路径判为界外（以前六条红线一起失明）", () => {
    const w = "C:\\Users\\alice\\proj"
    expect(isInside(w, normalize("C:\\Windows\\System32\\hosts"))).toBe(false)
    expect(isInside(w, normalize("C:/Users/alice/.aws/credentials"))).toBe(false)
  })

  it("界内的仍然判为界内", () => {
    expect(isInside("C:\\Users\\alice\\proj", normalize("C:\\Users\\alice\\proj\\src\\a.ts"))).toBe(true)
    expect(isInside("/w", "/w/src/a.ts")).toBe(true)
  })

  it("**只有盘符那个字母大小写不敏感**，其余部分照旧敏感", () => {
    expect(isInside("C:\\proj", normalize("c:\\proj\\a.ts"))).toBe(true)
    expect(isInside("C:\\Proj", normalize("C:\\proj\\a.ts"))).toBe(false)
  })

  it("同前缀但不同目录不算在内", () => {
    expect(isInside("/w", "/w2/a.ts")).toBe(false)
    expect(isInside("C:\\proj", normalize("C:\\proj2\\a.ts"))).toBe(false)
  })
})

describe("home 展开", () => {
  it("`~` 与 `$HOME` 都认", () => {
    expect(expandHome("~/a", "/h")).toBe("/h/a")
    expect(expandHome("$HOME/a", "/h")).toBe("/h/a")
    expect(expandHome("${HOME}/a", "/h")).toBe("/h/a")
  })

  it("别的变量不猜——那种该判「静态判不出」交人工", () => {
    expect(expandHome("$FOO/a", "/h")).toBe("$FOO/a")
  })
})
