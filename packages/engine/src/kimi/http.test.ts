import { describe, expect, it } from "vitest"
import { createKimiApi } from "./http.js"

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("Kimi Web HTTP", () => {
  it("只把 code=0 的 envelope 解开，并用 bearer header 认证", async () => {
    const seen: { input?: string; auth?: string } = {}
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.input = String(input)
      seen.auth = new Headers(init?.headers).get("Authorization") ?? undefined
      return response({ code: 0, msg: "success", data: { ok: true } })
    }) as typeof fetch
    const api = createKimiApi("http://127.0.0.1:1234/api/v1", "secret-token", fetcher)

    await expect(api.get("meta")).resolves.toEqual({ ok: true })
    expect(seen).toEqual({ input: "http://127.0.0.1:1234/api/v1/meta", auth: "Bearer secret-token" })
  })

  it("HTTP 200 里的业务错误也抛出，不能当成功", async () => {
    const fetcher = (async () => response({ code: 40902, msg: "session busy", data: null })) as typeof fetch
    const api = createKimiApi("http://127.0.0.1/api/v1", "token", fetcher)

    await expect(api.post("sessions/s:fork", {})).rejects.toMatchObject({
      name: "KimiApiError",
      code: 40902,
      message: "session busy",
    })
  })

  it("JSON 不是 envelope 时给稳定错误，不漏出 TypeError", async () => {
    const fetcher = (async () => response(null)) as typeof fetch
    const api = createKimiApi("http://127.0.0.1/api/v1", "token", fetcher)

    await expect(api.get("meta")).rejects.toMatchObject({ name: "KimiApiError", message: expect.stringContaining("envelope") })
  })
})
