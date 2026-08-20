import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import type { KimiApi } from "./http.js"
import type { KimiLease } from "./server.js"
import { KimiSession } from "./session.js"
import type { KimiPrompt, KimiSnapshot } from "./wire.js"

function snapshot(): KimiSnapshot {
  return {
    as_of_seq: 0,
    epoch: "ep1",
    session: {
      id: "s1",
      title: "",
      busy: false,
      last_turn_reason: "completed",
      metadata: { cwd: "/work" },
      agent_config: { model: "k2" },
    },
    in_flight_turn: null,
    pending_approvals: [],
    pending_questions: [],
  }
}

function request(events: Event[]): StartRequest {
  return {
    threadId: "th1",
    cwd: "/work",
    trust: "full",
    home: "/home/u",
    memory: () => [],
    emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: true, remember: "once" }),
  }
}

function lease(api: KimiApi): KimiLease {
  return {
    baseUrl: "http://127.0.0.1/api/v1",
    wsUrl: "ws://127.0.0.1/api/v1/ws",
    protocol: "p",
    api,
    onCrash: () => () => undefined,
    release: () => Promise.resolve(),
  }
}

describe("Kimi 会话插话", () => {
  it("运行中先排成 queued，再调用原生 prompts:steer", async () => {
    const posts: { path: string; body: unknown }[] = []
    const prompts: KimiPrompt[] = [
      { prompt_id: "p1", status: "running" },
      { prompt_id: "p2", status: "queued" },
    ]
    const api: KimiApi = {
      get: <T>() => Promise.resolve(undefined as T),
      post: <T>(path: string, body?: unknown) => {
        posts.push({ path, body })
        return Promise.resolve((path.endsWith("/prompts") ? prompts.shift() : {}) as T)
      },
    }
    const session = new KimiSession(request([]), lease(api), {
      id: "s1",
      status: { busy: false, model: "k2" },
      snapshot: snapshot(),
    })

    await session.prompt("开始", "turn-1")
    await session.steer("改向")
    expect(posts).toEqual([
      { path: "sessions/s1/prompts", body: { content: [{ type: "text", text: "开始" }] } },
      { path: "sessions/s1/prompts", body: { content: [{ type: "text", text: "改向" }] } },
      { path: "sessions/s1/prompts:steer", body: { prompt_ids: ["p2"] } },
    ])
    await session.dispose()
  })

  it("竞态里若第二句已经变成新轮次，先 abort 原生 prompt 再抛，让 host 安全退回排队", async () => {
    const paths: string[] = []
    const prompts: KimiPrompt[] = [
      { prompt_id: "p1", status: "running" },
      { prompt_id: "p2", status: "running" },
    ]
    const api: KimiApi = {
      get: <T>() => Promise.resolve(undefined as T),
      post: <T>(path: string) => {
        paths.push(path)
        return Promise.resolve((path.endsWith("/prompts") ? prompts.shift() : {}) as T)
      },
    }
    const session = new KimiSession(request([]), lease(api), {
      id: "s1",
      status: { busy: false, model: "k2" },
      snapshot: snapshot(),
    })

    await session.prompt("开始", "turn-1")
    await expect(session.steer("太晚了")).rejects.toThrow("改为排队发送")
    expect(paths).toContain("sessions/s1/prompts/p2:abort")
    expect(paths).not.toContain("sessions/s1/prompts:steer")
    await session.dispose()
  })
})
