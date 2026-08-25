import { describe, expect, it } from "vitest"
import { claudeAccount } from "./account.js"

describe("Claude SDK 账号", () => {
  it("读取公开的邮箱与订阅类型", () => {
    expect(claudeAccount({ email: " user@example.com ", subscriptionType: "max" })).toEqual({
      label: "user@example.com", plan: "max",
    })
  })

  it("第三方 provider 没报身份时保持缺席，不拿 provider 名冒充账号", () => {
    expect(claudeAccount({ apiProvider: "bedrock", apiKeySource: "user" })).toBeUndefined()
    expect(claudeAccount({ email: "" })).toBeUndefined()
    expect(claudeAccount(undefined)).toBeUndefined()
  })
})
