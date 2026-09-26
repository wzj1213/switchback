import { describe, expect, it } from "vitest"
import { isShell, isToolRoot, parseLsofPeers, parseNettop, parsePs, treeOf, zcodeMains } from "./egress-sample.js"

const PS = [
  "  100     1   100 /Applications/omni.app/Contents/MacOS/omni",
  "  101   100   100 /Applications/omni.app/Contents/Frameworks/omni Helper.app/Contents/MacOS/omni Helper --type=gpu-process",
  "  200   100   200 /opt/engines/claude --output-format stream-json --verbose",
  "  201   200   200 /bin/zsh -c git push origin main",
  "  202   201   200 git push origin main",
  "  203   202   200 /usr/bin/ssh git@example.com git-receive-pack",
  "  204   200   200 node /opt/mcp/server.js",
  "  205     1   200 node /opt/engines/orphaned-helper.js",
  "  206   200   200 /usr/bin/git push origin big-branch",
  "  300     1   300 /Applications/ZCode.app/Contents/MacOS/ZCode",
  "  301   300   300 /Applications/ZCode.app/Contents/Frameworks/ZCode Helper.app/Contents/MacOS/ZCode Helper --type=utility",
  "garbage line",
].join("\n")

describe("读进程表", () => {
  it("路径里带空格的命令行整段留着；读不懂的行跳过", () => {
    const procs = parsePs(PS)
    expect(procs).toHaveLength(11)
    expect(procs[1]?.command).toBe("/Applications/omni.app/Contents/Frameworks/omni Helper.app/Contents/MacOS/omni Helper --type=gpu-process")
    expect(procs[2]).toEqual({ pid: 200, ppid: 100, pgid: 200, command: "/opt/engines/claude --output-format stream-json --verbose" })
  })
})

describe("一个引擎底下的整棵树", () => {
  const tree = treeOf(parsePs(PS), 200)

  it("它自己：组长、它直接拉起的 MCP 服务、父进程先退了但还在同一个进程组里的", () => {
    expect([...tree.runtime].sort()).toEqual([200, 204, 205])
  })

  it("它跑的命令：shell 和 shell 底下的一切，还有它不经 shell 直接拉起的 git push——模型调了一条命令，转录区里看得见", () => {
    expect([...tree.tools].sort()).toEqual([201, 202, 203, 206])
  })

  it("别人的进程一个都不进来：omni 自己、它的 helper、单独开着的 ZCode", () => {
    const all = [...tree.runtime, ...tree.tools]
    for (const pid of [100, 101, 300, 301]) expect(all).not.toContain(pid)
  })
})

describe("认 shell", () => {
  const cases: readonly (readonly [string, boolean])[] = [
    ["/bin/zsh -c ls", true],
    ["bash -lc 'npm test'", true],
    ["-zsh", true],
    ["/opt/homebrew/bin/fish", true],
    ["/usr/bin/git push", false],
    ["node /opt/engines/zsh-helper.js", false],
    ["/opt/engines/bashful", false],
  ]
  for (const [command, want] of cases) {
    it(command, () => {
      expect(isShell(command)).toBe(want)
    })
  }
})

describe("读 nettop", () => {
  it("名字.pid,收,发——名字里有点号时 pid 取最后一段；表头和空行跳过", () => {
    const text = ",bytes_in,bytes_out,\nclaude.200,5120,2097152,\nnode.js.204,10,20,\n\n"
    const traffic = parseNettop(text)
    expect(traffic.get(200)).toEqual({ received: 5120, sent: 2097152 })
    expect(traffic.get(204)).toEqual({ received: 10, sent: 20 })
    expect(traffic.size).toBe(2)
  })
})

describe("算「它跑的命令」的那一层", () => {
  const cases: readonly (readonly [string, boolean])[] = [
    ["/usr/bin/git push origin main", true],
    ["rsync -a . host:/srv", true],
    ["/opt/homebrew/bin/gh release upload v1 big.zip", true],
    ["node /opt/engines/upload.js", false],
    ["python3 -m http.server", false],
    ["/opt/engines/gitlike --push", false],
  ]
  for (const [command, want] of cases) {
    it(command, () => {
      expect(isToolRoot(command)).toBe(want)
    })
  }
})

describe("单独开着的 ZCode", () => {
  it("只认主进程：helper 挂在它下面，不另算一份", () => {
    expect(zcodeMains(parsePs(PS))).toEqual([300])
  })
})

describe("当时它连着谁", () => {
  it("取 -> 后面那一段，本机回环不算，重复的只留一个", () => {
    const text = [
      "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
      "ZCode   300 me   31u  IPv4 0x1 0t0 TCP 198.51.100.5:53001->203.0.113.9:443 (ESTABLISHED)",
      "ZCode   300 me   32u  IPv4 0x2 0t0 TCP 198.51.100.5:53002->203.0.113.9:443 (ESTABLISHED)",
      "ZCode   300 me   33u  IPv6 0x3 0t0 TCP [2001:db8::5]:53003->[2001:db8::1]:443 (ESTABLISHED)",
      "ZCode   300 me   34u  IPv4 0x4 0t0 TCP 127.0.0.1:53004->127.0.0.1:61000 (ESTABLISHED)",
    ].join("\n")
    expect(parseLsofPeers(text)).toEqual(["203.0.113.9:443", "[2001:db8::1]:443"])
  })
})
