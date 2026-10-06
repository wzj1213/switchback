import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
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
    askQuestion: () => Promise.resolve({ dismissed: true }),
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
    pid: () => undefined,
  }
}

describe("Kimi 会话能力", () => {
  it("公开 WebSocket 已实报子代理生命周期，因此声明活动面板能力", async () => {
    const api: KimiApi = { get: <T>() => Promise.resolve(undefined as T), post: <T>() => Promise.resolve({} as T) }
    const session = new KimiSession(request([]), lease(api), {
      id: "s1", status: { busy: false, model: "k2" }, snapshot: snapshot(),
    })

    expect(session.capabilities().activity).toBe(true)
    await session.dispose()
  })
})

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

describe("Kimi skill 命令", () => {
  it("内置与外部 skill 都走原生 activate，不再作为普通提示词发送", async () => {
    const cases = [
      {
        skill: { name: "write-goal", description: "写目标", source: "builtin" },
        command: "write-goal",
        prompt: "/write-goal 发布稳定版",
        path: "sessions/s1/skills/write-goal:activate",
        body: { args: "发布稳定版" },
      },
      {
        skill: { name: "review", description: "审查", source: "user" },
        command: "skill:review",
        prompt: "/skill:review --fix",
        path: "sessions/s1/skills/review:activate",
        body: { args: "--fix" },
      },
    ] as const

    for (const row of cases) {
      const posts: { path: string; body: unknown }[] = []
      const api: KimiApi = {
        get: <T>() => Promise.resolve({ skills: [row.skill] } as T),
        post: <T>(path: string, body?: unknown) => {
          posts.push({ path, body })
          return Promise.resolve({ activated: true, skill_name: row.skill.name } as T)
        },
      }
      const session = new KimiSession(request([]), lease(api), {
        id: "s1",
        status: { busy: false, model: "k2" },
        snapshot: snapshot(),
      })

      await expect(session.commands()).resolves.toMatchObject([{ name: row.command }])
      await session.prompt(row.prompt, "turn-skill")
      expect(posts[0]).toEqual({ path: row.path, body: row.body })
      expect(posts.some((post) => post.path === "sessions/s1/prompts")).toBe(false)
      await session.dispose()
    }
  })

  it("Kimi Web UI 自己的控制命令不冒充引擎上报 skill", async () => {
    const posts: { path: string; body: unknown }[] = []
    const api: KimiApi = {
      get: <T>() => Promise.resolve({ skills: [{ name: "write-goal", source: "builtin" }] } as T),
      post: <T>(path: string, body?: unknown) => {
        posts.push({ path, body })
        return Promise.resolve({ prompt_id: "p1", status: "running" } as T)
      },
    }
    const session = new KimiSession(request([]), lease(api), {
      id: "s1",
      status: { busy: false, model: "k2" },
      snapshot: snapshot(),
    })

    await session.commands()
    await session.prompt("/goal status", "turn-goal")
    expect(posts[0]).toEqual({
      path: "sessions/s1/prompts",
      body: { content: [{ type: "text", text: "/goal status" }] },
    })
    await session.dispose()
  })
})

describe("Kimi 写操作后的状态读回", () => {
  it("默认配置读不到时仍保留服务端已经给出的模型清单", async () => {
    const events: Event[] = []
    const api: KimiApi = {
      get: <T>(path: string) => {
        if (path === "models") return Promise.resolve({ items: [{ provider: "moonshot", model: "k3" }] } as T)
        if (path === "config") return Promise.reject(new Error("config timeout"))
        return Promise.resolve({ busy: false, model: "k3" } as T)
      },
      post: <T>() => Promise.resolve({} as T),
    }
    const session = new KimiSession(request(events), lease(api), {
      id: "s1",
      status: { busy: false, model: "k2" },
      snapshot: snapshot(),
    })

    await expect(session.models()).resolves.toMatchObject([{ id: "k3" }])
    await session.dispose()
  })

  it("权限 POST 已成功但 status 暂时失败时，保留成功结果并明确降级", async () => {
    const events: Event[] = []
    const api: KimiApi = {
      get: () => Promise.reject(new Error("status timeout")),
      post: <T>() => Promise.resolve({} as T),
    }
    const session = new KimiSession(request(events), lease(api), {
      id: "s1",
      status: { busy: false, model: "k2" },
      snapshot: snapshot(),
    })

    await expect(session.setTrust("auto-edit")).resolves.toEqual({ restart: false })
    expect(events.find((event) => event.type === "engine.status")).toMatchObject({
      status: "degraded",
      detail: expect.stringContaining("状态读回失败"),
    })
    await session.dispose()
  })

  it("模型 POST 成功但读回失败时仍落模型，只是不冒充强度已确认", async () => {
    const events: Event[] = []
    const api: KimiApi = {
      get: <T>(path: string) => {
        if (path === "models") {
          return Promise.resolve({
            items: [{ provider: "moonshot", model: "k3", support_efforts: ["low"], default_effort: "low" }],
          } as T)
        }
        if (path === "config") return Promise.resolve({ default_model: "k3" } as T)
        return Promise.reject(new Error("status timeout"))
      },
      post: <T>() => Promise.resolve({} as T),
    }
    const session = new KimiSession(request(events), lease(api), {
      id: "s1",
      status: { busy: false, model: "k2" },
      snapshot: snapshot(),
    })

    await expect(session.setModel("k3", "low")).resolves.toEqual({})
    expect(events.filter((event) => event.type === "engine.status")).not.toHaveLength(0)
    await session.dispose()
  })
})
