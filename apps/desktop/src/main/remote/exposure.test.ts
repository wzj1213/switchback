import { describe, expect, it } from "vitest"
import { EXPOSED, judgeCall, PREF_KEYS, type Caller } from "./exposure.js"

const desk: Caller = { kind: "desk", maxTrust: "auto-edit" }
const deskReadOnly: Caller = { kind: "desk", maxTrust: "read-only" }
const phone: Caller = { kind: "phone", maxTrust: "full" }

/**
 * 远程能调哪几条宿主通道。**一张表穷举**：每一行是一个「谁、调什么、带什么」，
 * 期望要么放行、要么拒且理由里有那几个字。
 */
const CASES: readonly {
  label: string
  method: string
  arg?: unknown
  caller: Caller
  /** undefined = 放行；字符串 = 拒，且理由里含这一段。 */
  refused?: string
}[] = [
  { label: "电脑调读通道", method: "switchback:worksite", caller: desk },
  { label: "只读上限的电脑也能读", method: "switchback:workPatch", caller: deskReadOnly },
  { label: "电脑在自动审批档下能提交", method: "switchback:gitCommit", caller: desk },
  { label: "**只读上限不能借审核面板提交**", method: "switchback:gitCommit", caller: deskReadOnly, refused: "只读" },
  { label: "只读上限不能往宿主落贴图", method: "switchback:stashImage", caller: deskReadOnly, refused: "只读" },
  { label: "**手机端一条通道都不能调**，哪怕上限是完全", method: "switchback:worksite", caller: phone, refused: "手机" },
  { label: "表外的一律拒：自更新", method: "switchback:selfUpdate", caller: desk, refused: "只能在那台机器上做" },
  { label: "表外的一律拒：试接任意可执行文件", method: "switchback:tryAcpEngine", caller: desk, refused: "只能在那台机器上做" },
  { label: "表外的一律拒：配对新设备", method: "switchback:remote/pair", caller: desk, refused: "只能在那台机器上做" },
  { label: "表外的一律拒：弹宿主屏幕上的目录框", method: "switchback:pickFolder", caller: desk, refused: "只能在那台机器上做" },
  { label: "**`__proto__` 查表不能查到原型上**", method: "__proto__", caller: desk, refused: "只能在那台机器上做" },
  { label: "读设置", method: "switchback:settings", caller: desk },
  { label: "改界面偏好", method: "switchback:settings", arg: { theme: "dark", pinned: [] }, caller: desk },
  { label: "只读上限也能改界面偏好——它不碰任何文件", method: "switchback:settings", arg: { theme: "dark" }, caller: deskReadOnly },
  {
    label: "**不能把自己的远程上限调高**",
    method: "switchback:settings",
    arg: { remote: { enabled: true, port: 17800, trustedHosts: [], maxTrust: "full" } },
    caller: desk,
    refused: "远程访问",
  },
  { label: "不能关外发守卫", method: "switchback:settings", arg: { egressStop: false }, caller: desk, refused: "外发守卫" },
  {
    label: "**整条拒，不放行一半**",
    method: "switchback:settings",
    arg: { theme: "dark", disabledEngines: [] },
    caller: desk,
    refused: "停用的引擎",
  },
  { label: "设置写入不是对象", method: "switchback:settings", arg: "dark", caller: desk, refused: "对象" },
  { label: "设置写入是数组", method: "switchback:settings", arg: ["theme"], caller: desk, refused: "对象" },
]

describe("远程可调的通道", () => {
  for (const one of CASES) {
    it(one.label, () => {
      const verdict = judgeCall(one.method, one.arg, one.caller)
      if (one.refused === undefined) {
        expect(verdict).toEqual({ ok: true })
        return
      }
      expect(verdict.ok).toBe(false)
      expect(verdict.ok ? "" : verdict.reason).toContain(one.refused)
    })
  }

  it("白名单里的通道名都带 `switchback:` 前缀——写错一个字就是一条永远调不通的通道", () => {
    for (const name of Object.keys(EXPOSED)) expect(name.startsWith("switchback:")).toBe(true)
  })

  it("**能落盘、能动宿主的那几类一条都不在表里**", () => {
    const hostOnly = [
      "switchback:selfUpdate",
      "switchback:installEngine",
      "switchback:updateEngine",
      "switchback:addAcpEngine",
      "switchback:tryAcpEngine",
      "switchback:rescanEngines",
      "switchback:remote/pair",
      "switchback:remote/revoke",
      "switchback:remote/sync",
      "switchback:remote/deviceTrust",
      "switchback:openEngines",
      "switchback:diagnose",
      "switchback:reveal",
    ]
    for (const name of hostOnly) expect(Object.hasOwn(EXPOSED, name)).toBe(false)
  })

  it("设置白名单里没有任何一个会放宽权限的键", () => {
    for (const key of ["remote", "egressStop", "zcodeLock", "disabledEngines", "defaultTrust", "dsh"]) {
      expect(PREF_KEYS.has(key)).toBe(false)
    }
  })
})
