import { describe, expect, it, vi } from "vitest"

/**
 * `crash.ts` 里绝大部分是 Electron 生命周期的接线，测不了也不值得测。
 * 值得测的只有一条，而它恰恰是最容易写反的：**转储的内容绝不能进诊断报告**。
 *
 * 所以这里把 `electron` 与 `crash` 都 mock 掉，只验 `buildReport` 的输出契约。
 */

vi.mock("electron", () => ({
  app: {
    getVersion: () => "9.9.9",
    getPath: () => "/tmp/switchback-test",
    isPackaged: false,
  },
  dialog: { showSaveDialog: vi.fn() },
}))

vi.mock("./crash.js", () => ({
  dumpDir: () => "/tmp/switchback-test/CrashDumps",
}))

const { buildReport } = await import("./diagnose.js")

const logger = { file: "/tmp/switchback-test/does-not-exist.log", write: () => undefined }

describe("诊断报告里的崩溃那一段", () => {
  it("**只有文件名和时间，没有转储内容**——这份报告是要发给别人的", async () => {
    const report = await buildReport(logger, {
      uncleanExit: true,
      dumps: [{ name: "abc-123.dmp", at: 1_700_000_000_000 }],
    }, "zh-CN")
    expect(report).toContain("abc-123.dmp")
    expect(report).toContain("内容不在本报告里")
    expect(report).toContain("上次不是正常退出的")
  })

  it("没崩过就直说没崩过，不留一段空标题让人以为漏了", async () => {
    const report = await buildReport(logger, { uncleanExit: false, dumps: [] }, "zh-CN")
    expect(report).toContain("没有崩溃记录")
  })

  it("退出不干净但没有转储时，两件事分开说", async () => {
    const report = await buildReport(logger, { uncleanExit: true, dumps: [] }, "zh-CN")
    expect(report).toContain("上次不是正常退出的")
    expect(report).toContain("没有崩溃转储文件")
  })

  it("**报告头上照实写「发出去之前扫一眼」**——说满了比说少了危险", async () => {
    const report = await buildReport(logger, { uncleanExit: false, dumps: [] }, "zh-CN")
    expect(report).toContain("不含会话内容")
    expect(report).toContain("发出去之前扫一眼")
    const en = await buildReport(logger, { uncleanExit: false, dumps: [] }, "en")
    expect(en).toContain("No conversation content")
    expect(en).toContain("Skim it before you send it")
  })
})
