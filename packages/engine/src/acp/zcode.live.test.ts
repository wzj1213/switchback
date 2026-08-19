import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createAcpDriver } from "./driver.js"

/**
 * 对着**真的** ZCode 桥验一遍「换模型 / 换强度」。
 *
 *   pnpm test:live
 *
 * ## 为什么这条非得是 live
 *
 * 它钉的是一件纯函数测不到的事：**这家适配器到底认哪一发 RPC**。
 * 规范拼写的 `session/set_model` 在 zcode-acp-server 上是
 * `-32601 Method not found`（实测），而 omni 一直发的就是它——
 * 用户点一下模型下拉，界面上弹一条红色「引擎故障」。
 *
 * 桩测试永远发现不了这个：桩会照着我们以为的样子回答。
 *
 * 前提：装了 ZCode.app 并登录过、`npm i -g zcode-acp-server`。
 * 缺任何一样这条会失败——**那正是它该说的话**，不要吞掉。
 */
describe("ZCode · live", () => {
  it(
    "换模型、换强度都真的落下去了",
    async () => {
      const events: Event[] = []
      const driver = createAcpDriver({
        id: "acp:zcode",
        command: "zcode-acp-server",
        args: [],
        env: { ZCODE_BIN: "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" },
      })
      const session = await driver.start({
        threadId: "th-live",
        cwd: mkdtempSync(join(tmpdir(), "omni-zcode-")),
        trust: "read-only",
        home: process.env["HOME"] ?? "",
        memory: () => [],
        emit: (event) => events.push(event),
        askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      })
      try {
        const models = await session.models()
        // 它自己报的清单，不是我们写死的——写死一份第二天就过期
        expect(models.length).toBeGreaterThan(0)
        /**
         * **换到「当前那个之外」的一个。**
         *
         * 不是随手挑第一个：这台机器上桥报的第一条是
         * `anthropic\GLM-5.3`——它的 provider 在 ZCode 的 config.json 里坏着
         *（registry 同步报 `providers.2.models: Too small`），换过去必然失败。
         * 那是那份配置的问题，不是 omni 的；而这条测试要钉的是**换得成的那条路**。
         */
        const target = models.find((m) => m.isDefault !== true) ?? models[0]
        expect(target).toBeDefined()

        // **这一发就是炸过的那一发。** 修之前：Method not found → 红色引擎故障
        await session.setModel(target?.id ?? "")

        // 强度：id 各家不一样（kimi `thinking`、ZCode `thought`），
        // 写死一个名字的下场是选了什么都没发生，而界面照样显示新档位
        const level = target?.efforts?.[0]
        if (level !== undefined) await session.setModel(target?.id ?? "", level)

        // 换完之后 agent 会把新的可选项推回来（`config_option_update`），
        // 驱动据此转发一份新清单——强度的词表是跟着模型走的
        expect(events.some((e) => e.type === "models.updated")).toBe(true)
      } finally {
        await session.dispose()
      }
    },
    120_000,
  )
})

/**
 * 压缩上下文这一位以前一律报 false，理由是「驱动没实现，翻成 true 就是给一个
 * 点了没反应的入口」。`turn.ts` 把账还了之后，这条钉的是**它真的落下去了**。
 *
 * 三家实测只有 zcode 有这个方法（kimi、grok 都是 `-32601 Method not found`），
 * 所以这条只能在这儿验——也正因为如此它必须存在：别家给不了这个证据。
 */
describe("ZCode · live · 压缩上下文", () => {
  it(
    "能力位报 true，而且 `session/compact` 真的调得通",
    async () => {
      const driver = createAcpDriver({
        id: "acp:zcode",
        command: "zcode-acp-server",
        args: [],
        env: { ZCODE_BIN: "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" },
        compact: true,
      })
      const session = await driver.start({
        threadId: "th-live-compact",
        cwd: mkdtempSync(join(tmpdir(), "omni-zcode-c-")),
        trust: "read-only",
        home: process.env["HOME"] ?? "",
        memory: () => [],
        emit: () => undefined,
        askUser: () => Promise.resolve({ allow: false, remember: "once" as const }),
      })
      try {
        expect(session.capabilities?.().compact).toBe(true)
        // 空会话上压缩也该成功（实测回一份空 snapshot）——**不抛就是通了**
        await session.compact?.()
      } finally {
        await session.dispose()
      }
    },
    120_000,
  )

  it("**没说支持的那家不给入口，也不发那一发 RPC**——不填就是没有", async () => {
    const driver = createAcpDriver({
      id: "acp:zcode",
      command: "zcode-acp-server",
      args: [],
      env: { ZCODE_BIN: "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" },
    })
    const session = await driver.start({
      threadId: "th-live-nocompact",
      cwd: mkdtempSync(join(tmpdir(), "omni-zcode-n-")),
      trust: "read-only",
      home: process.env["HOME"] ?? "",
      memory: () => [],
      emit: () => undefined,
      askUser: () => Promise.resolve({ allow: false, remember: "once" as const }),
    })
    try {
      expect(session.capabilities?.().compact).toBe(false)
      await expect(session.compact?.()).rejects.toThrow(/不支持压缩上下文/)
    } finally {
      await session.dispose()
    }
  }, 120_000)
})
