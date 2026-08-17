import { describe, expect, it } from "vitest"
import { redirectTargets, signature, splitSegments, unwrapShell } from "./command.js"

describe("unwrapShell", () => {
  it("剥掉 codex 的包壳", () => {
    expect(unwrapShell(`/bin/zsh -lc 'pnpm test'`)).toBe("pnpm test")
    expect(unwrapShell(`/bin/bash -c "ls -la"`)).toBe("ls -la")
    expect(unwrapShell(`sh -c 'echo hi'`)).toBe("echo hi")
  })

  it("不是包壳的原样返回，别把正常命令切坏", () => {
    expect(unwrapShell("zsh install.sh")).toBe("zsh install.sh")
    expect(unwrapShell("pnpm test")).toBe("pnpm test")
    // 引号没闭合就不算包壳
    expect(unwrapShell(`/bin/zsh -lc 'ls`)).toBe(`/bin/zsh -lc 'ls`)
  })

  it("只剥一层——嵌套包壳本身就该人工看", () => {
    expect(unwrapShell(`/bin/zsh -lc "/bin/zsh -lc 'ls'"`)).toBe(`/bin/zsh -lc 'ls'`)
  })
})

describe("包壳不能让判定器失明", () => {
  it("签名剥壳后才有区分度——否则 sig 永远是 /bin/zsh", () => {
    const wrapped = splitSegments(`/bin/zsh -lc 'git push origin main'`)
    expect(wrapped.segments.map(signature)).toEqual(["git push"])
  })

  it("包壳里的命令替换照样被认出来——不然 $(...) 藏进引号就绕过去了", () => {
    const r = splitSegments(`/bin/zsh -lc 'echo $(whoami)'`)
    expect(r.unparseable).toBe(true)
  })

  it("包壳里的分隔符照样切分——`a && rm -rf /` 不能因为包了一层就整段当一条", () => {
    const r = splitSegments(`/bin/zsh -lc 'pnpm test && rm -rf /tmp/x'`)
    expect(r.segments.map((s) => s.program)).toEqual(["pnpm", "rm"])
  })
})

describe("重定向目标", () => {
  it("`> f` 认得出——**这是 shell 里最常见的写文件方式**", () => {
    expect(redirectTargets("echo ok > /tmp/x.txt")).toEqual(["/tmp/x.txt"])
  })

  it("`>>` 追加也算写", () => {
    expect(redirectTargets("echo ok >> out.log")).toEqual(["out.log"])
  })

  it("`2>` 和 `&>` 也认", () => {
    expect(redirectTargets("cmd 2> err.txt")).toEqual(["err.txt"])
    expect(redirectTargets("cmd &> all.txt")).toEqual(["all.txt"])
  })

  it("带引号的路径去掉引号", () => {
    expect(redirectTargets(`echo x > "带 空格.txt"`)).toEqual(["带 空格.txt"])
  })

  it("`<` 是读，不算", () => {
    expect(redirectTargets("cmd < input.txt")).toEqual([])
  })

  it("`>&2` 是复制文件描述符，不是文件", () => {
    expect(redirectTargets("echo boom >&2")).toEqual([])
  })

  it("`/dev/null` 不用保护", () => {
    expect(redirectTargets("noisy 2>/dev/null")).toEqual([])
  })

  it("一条命令里多个重定向都要认", () => {
    expect(redirectTargets("cmd > a.txt 2> b.txt")).toEqual(["a.txt", "b.txt"])
  })
})

/**
 * 点号 source 必须锚在**程序位**。原来是「任意位置的裸 `.`」，
 * 而表示当前目录的 `.` 是 shell 里最常见的操作数——那条正则把
 * `find . -name x`、`git add . && …` 全判成了间接执行。
 *
 * 这个误判一直没露头，因为 ACP 那条路上命令原文压根没送到判定器。
 */
describe("点号 source 只算程序位", () => {
  const opaque = (command: string): boolean => splitSegments(command).unparseable

  it("真的 source 要认出来", () => {
    expect(opaque(". ./env.sh")).toBe(true)
    expect(opaque("cd /w && . ./env.sh")).toBe(true)
    expect(opaque("echo hi; . setup")).toBe(true)
    expect(opaque("cat f | . /dev/stdin")).toBe(true)
  })

  it("当前目录那个 `.` 不算——这才是常态", () => {
    expect(opaque("find . -name x.json")).toBe(false)
    expect(opaque("git add . && git commit -m x")).toBe(false)
    expect(opaque("cp . /tmp/x")).toBe(false)
    expect(opaque("rg foo . --files")).toBe(false)
    expect(opaque("git add .")).toBe(false)
  })
})
