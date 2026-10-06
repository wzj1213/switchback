import { describe, expect, it } from "vitest"
import {
  capabilitiesOf,
  canList,
  catalogOf,
  contextWindows,
  effortsOf,
  modelCall,
  modelCatalogOf,
  modelsOf,
  sayWhy,
  sessionsOf,
} from "./setup.js"

/**
 * ACP 的形状全部来自**实测的 kimi 响应**（`kimi acp`，0.36.1），不是照着协议文档编的。
 */

describe("能力由 agent 自报，不写死", () => {
  const kimi = {
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true, audio: false, embeddedContext: true },
      sessionCapabilities: { list: {}, resume: {}, close: {}, delete: {}, fork: {} },
    },
  }

  it("**实测的 kimi 握手**：能贴图、能原生分叉", () => {
    expect(capabilitiesOf(kimi)).toEqual({
      compact: false,
      attachments: true,
      steer: false,
      fork: true,
      rewind: false,
      modeReadback: false,
      sideQuestion: false,
      // ACP 协议里没有「我会报子 agent / 编排进度」这个声明位，所以是 false 而不是"没查"
      activity: false,
    })
  })

  it("**空对象就是「支持」**——ACP 拿它当标记，判据是键在不在，不是值是不是 true", () => {
    expect(capabilitiesOf({ agentCapabilities: { sessionCapabilities: { fork: {} } } }).fork).toBe(true)
    expect(capabilitiesOf({ agentCapabilities: { sessionCapabilities: { fork: {} } } }).rewind).toBe(false)
    expect(capabilitiesOf({ agentCapabilities: { sessionCapabilities: {} } }).fork).toBe(false)
  })

  it("厂商公开的分叉扩展可以补足标准握手，但仍不冒充历史回退", () => {
    expect(capabilitiesOf(undefined, { fork: true })).toMatchObject({ fork: true, rewind: false })
  })

  it("不报图片能力就不给贴图入口——塞过去会被静默丢掉，比不给更糟", () => {
    expect(capabilitiesOf({ agentCapabilities: {} }).attachments).toBe(false)
  })

  it("未显式验证 compact / steer 时默认 false，不能拿一家实现替全家回答", () => {
    expect(capabilitiesOf(kimi).compact).toBe(false)
    expect(capabilitiesOf(kimi).steer).toBe(false)
  })

  it("什么都没报时一样不崩", () => {
    expect(capabilitiesOf(undefined).fork).toBe(false)
  })

  it("只有已接住原生私有活动通知的适配器才声明 activity", () => {
    expect(capabilitiesOf(undefined, { activity: true }).activity).toBe(true)
    expect(capabilitiesOf(undefined).activity).toBe(false)
  })

  it("能不能列历史也看它自己说", () => {
    expect(canList(kimi)).toBe(true)
    expect(canList({ agentCapabilities: { sessionCapabilities: {} } })).toBe(false)
  })
})

describe("推理强度：有的适配器用一个 configOption 表达它", () => {
  const thinking = {
    configOptions: [
      { id: "model", category: "model", currentValue: "k3", options: [{ value: "k3", name: "K3" }] },
      {
        id: "thinking",
        category: "thought_level",
        currentValue: "high",
        options: [{ value: "low" }, { value: "high" }, { value: "max" }],
      },
    ],
  }

  it("**实测的 kimi 形状**：low / high / max，当前 high", () => {
    expect(effortsOf(thinking)).toEqual({ id: "thinking", efforts: ["low", "high", "max"], current: "high" })
  })

  /**
   * **`id` 必须带出来。** 设回去时报的正是它，而各家起的名字不一样：
   * kimi 叫 `thinking`，**ZCode 叫 `thought`**（它自己的注释写着：category 用
   * `thought_level` 是为了让客户端认得出来，`id` 保持 `thought` 因为那是
   * `session/set_config_option` 寻址用的）。写死一个名字的下场是在另一家
   * 选了强度**什么都没发生**，而界面照样把新档位显示出来。
   */
  it("**实测的 ZCode 形状**：id 是 thought，不是 thinking", () => {
    const zcode = {
      configOptions: [
        {
          id: "thought",
          category: "thought_level",
          currentValue: "max",
          options: [{ value: "low" }, { value: "high" }, { value: "max" }],
        },
      ],
    }
    expect(effortsOf(zcode)?.id).toBe("thought")
  })

  it("认 category 优先于认 id——id 是各家自己起的名字", () => {
    const odd = { configOptions: [{ id: "reasoning", category: "thought_level", options: [{ value: "a" }] }] }
    expect(effortsOf(odd)?.efforts).toEqual(["a"])
  })

  it("没有这一项就是 undefined——**别报一个空的强度选择器**", () => {
    expect(effortsOf({ configOptions: [{ id: "model", options: [{ value: "x" }] }] })).toBeUndefined()
    expect(effortsOf({})).toBeUndefined()
  })
})

describe("当前模型要标出来", () => {
  it("**configOptions 里 currentValue 那个标 isDefault**——不标的话界面退回列表第一个，那是在撒谎", () => {
    const session = {
      configOptions: [
        {
          id: "model",
          currentValue: "kimi-code/k3",
          options: [{ value: "kimi-code/kimi-for-coding", name: "K2.7" }, { value: "kimi-code/k3", name: "K3" }],
        },
      ],
    }
    expect(modelsOf(session).find((m) => m.isDefault === true)?.label).toBe("K3")
  })

  it("新版走 models.currentModelId 那条路，同样要标", () => {
    const session = {
      models: {
        availableModels: [{ modelId: "a", name: "A" }, { modelId: "b", name: "B" }],
        currentModelId: "b",
      },
    }
    expect(modelsOf(session).find((m) => m.isDefault === true)?.label).toBe("B")
  })

  /**
   * 光在清单里打个标记不够：界面画的是**选中项**（`Thread.model`），不是清单里谁带标记。
   * agent 中途自己换模型时，走 `config_option_update` 重算这份清单——
   * 不把当前模型一起报出来的话，选中项就没人改，面板上会写着一个引擎已经不在跑的模型。
   */
  it("清单要连**当前是哪个**一起报出来，两条路都要", () => {
    const byOption = {
      configOptions: [
        {
          id: "model",
          currentValue: "kimi-code/k3",
          options: [{ value: "kimi-code/kimi-for-coding" }, { value: "kimi-code/k3" }],
        },
      ],
    }
    expect(catalogOf(byOption).model).toBe("kimi-code/k3")
    const byModels = {
      models: { availableModels: [{ modelId: "a" }, { modelId: "b" }], currentModelId: "b" },
    }
    expect(catalogOf(byModels).model).toBe("b")
  })

  it("引擎没报当前是哪个就缺席——不猜一个出来顶替", () => {
    const session = { models: { availableModels: [{ modelId: "a" }, { modelId: "b" }] } }
    expect(catalogOf(session).model).toBeUndefined()
  })
})

/**
 * 强度词表**跟着模型走**，两家实测：ZCode 的 GLM-5-Turbo 一档都没有，
 * kimi 的 K2.7 Coding 只有 `on`、K3 才有 low/high/max（2026-08-19 活体探测）。
 *
 * 这一组钉的是：那份词表只属于**引擎说的当前模型**。挂给全部不是「多给一点」，
 * 是会发错值——`ModelPicker` 换模型时读的正是目标模型的 `defaultEffort`。
 */
describe("强度词表挂给谁", () => {
  const kimi = {
    configOptions: [
      {
        id: "model",
        currentValue: "kimi-code/k3",
        options: [{ value: "kimi-code/kimi-for-coding" }, { value: "kimi-code/k3" }],
      },
      {
        id: "thinking",
        category: "thought_level",
        currentValue: "high",
        options: [{ value: "low" }, { value: "high" }, { value: "max" }, { value: "on" }],
      },
    ],
  }

  it("只挂到引擎说的当前模型上", () => {
    const models = catalogOf(kimi).models
    expect(models.find((m) => m.id === "kimi-code/k3")?.efforts).toEqual(["low", "high", "max", "on"])
  })

  it("**别的模型一档都不挂**——挂了就会在换过去时把它不支持的强度一起发出去", () => {
    const models = catalogOf(kimi).models
    const other = models.find((m) => m.id === "kimi-code/kimi-for-coding")
    expect(other?.efforts).toBeUndefined()
    expect(other?.defaultEffort).toBeUndefined()
  })

  // 这条分支只在引擎连当前模型都没报时才走到：那时分不出词表属于谁，
  // 而一个都不挂会让强度那一节整个消失——已知不精确好过已知缺席
  it("引擎没报当前模型时退回挂给全部", () => {
    const blind = {
      configOptions: [
        { id: "model", options: [{ value: "a" }, { value: "b" }] },
        { id: "thinking", category: "thought_level", options: [{ value: "low" }, { value: "high" }] },
      ],
    }
    expect(catalogOf(blind).models.every((m) => m.efforts?.length === 2)).toBe(true)
  })

  // grok 那条路（`_meta.reasoningEfforts`，每个模型自带）不受这次改动影响
  it("模型自带的强度不受影响——grok 走的是模型扩展位那条路", () => {
    const grok = {
      models: {
        availableModels: [
          { modelId: "a", _meta: { reasoningEfforts: [{ value: "low" }, { value: "high" }] } },
          { modelId: "b", _meta: { reasoningEfforts: [{ value: "max" }] } },
        ],
        currentModelId: "a",
      },
    }
    const models = catalogOf(grok).models
    expect(models.find((m) => m.id === "a")?.efforts).toEqual(["low", "high"])
    expect(models.find((m) => m.id === "b")?.efforts).toEqual(["max"])
  })
})

describe("历史会话清单", () => {
  const raw = {
    sessions: [
      { sessionId: "s1", cwd: "/w", title: "改分页", updatedAt: "2026-08-16T10:00:00.000Z" },
      { sessionId: "s2", cwd: "/w", title: null, updatedAt: "2026-08-16T12:00:00.000Z" },
      { sessionId: "s3", cwd: "", title: "早期遗留", updatedAt: "2026-08-16T13:00:00.000Z" },
      { cwd: "/w", title: "没有句柄", updatedAt: "2026-08-16T14:00:00.000Z" },
    ],
  }

  it("**最近动过的在前**", () => {
    expect(sessionsOf(raw, 10).map((t) => t.handle)).toEqual(["s2", "s1"])
  })

  it("**没有工作区的不列**——实测 kimi 的清单里真有 `cwd: \"\"` 的旧条目，接过来工作区边界就错了", () => {
    expect(sessionsOf(raw, 10).some((t) => t.handle === "s3")).toBe(false)
  })

  it("没有句柄的不列：接不过来，列出来点了就报错", () => {
    expect(sessionsOf(raw, 10)).toHaveLength(2)
  })

  it("没标题给个占位，不给空字符串（那一行会变成一块空白）", () => {
    expect(sessionsOf(raw, 10).find((t) => t.handle === "s2")?.title).not.toBe("")
  })

  it("有上限", () => {
    expect(sessionsOf(raw, 1)).toHaveLength(1)
  })

  it("时间认不出给 0，**排到最后**——不要编一个「现在」把它顶到最前面", () => {
    const odd = { sessions: [{ sessionId: "x", cwd: "/w", updatedAt: "不是时间" }] }
    expect(sessionsOf(odd, 10)[0]?.updatedAt).toBe(0)
  })

  it("认不出的形状给空数组，不抛", () => {
    expect(sessionsOf(undefined, 10)).toEqual([])
  })
})

/**
 * ACP 没有为「窗口多大」定字段，它在扩展位里：实测 grok 每个模型报
 * `_meta.totalContextTokens`。没有分母就不画比例条，所以这张表不能猜。
 */
describe("上下文窗口大小", () => {
  it("按模型建表", () => {
    expect(
      contextWindows({
        models: {
          currentModelId: "grok-4.6",
          availableModels: [
            { modelId: "grok-4.6", _meta: { totalContextTokens: 500000 } },
            { modelId: "grok-4.5", _meta: { totalContextTokens: 262144 } },
          ],
        },
      }),
    ).toEqual({ "grok-4.6": 500000, "grok-4.5": 262144 })
  })

  it("报不上来的模型不入表——不猜一个分母", () => {
    expect(
      contextWindows({
        models: {
          availableModels: [
            { modelId: "a" },
            { modelId: "b", _meta: null },
            { modelId: "c", _meta: { totalContextTokens: 0 } },
            { _meta: { totalContextTokens: 100 } },
          ],
        },
      }),
    ).toEqual({})
  })

  it("一个模型都没有也不抛", () => {
    expect(contextWindows({})).toEqual({})
  })
})

/**
 * **清单从哪儿读的，就设回哪儿。**
 *
 * 这条是拿一条红色故障换来的：ZCode 的桥（zcode-acp-server）只实现了
 * `session/set_config_option`，规范拼写的 `session/set_model` 在它那儿是
 * `Method not found`。于是点一下模型下拉，界面上弹「引擎故障」——
 * 而用户什么都没做错。
 */
describe("换模型往哪儿发", () => {
  it("新版报 models.availableModels：走规范的 session/set_model", () => {
    const session = { models: { availableModels: [{ modelId: "a", name: "A" }], currentModelId: "a" } }
    expect(modelCatalogOf(session).configId).toBeUndefined()
  })

  it("**只有 configOptions（ZCode / 旧版 codex-acp）：设回那个 configId**", () => {
    const session = {
      configOptions: [
        { id: "model", category: "model", currentValue: "GLM-5.3", options: [{ value: "GLM-5.3", name: "GLM-5.3" }] },
      ],
    }
    expect(modelCatalogOf(session).configId).toBe("model")
    expect(modelCatalogOf(session).models.map((m) => m.id)).toEqual(["GLM-5.3"])
  })

  /** 这一条钉的就是炸过的那一发：发给谁、带什么字段。 */
  it("**ZCode 那条真的发成 set_config_option**，不是 set_model", () => {
    expect(modelCall("model", "s1", "GLM-5.3")).toEqual({
      method: "session/set_config_option",
      params: { sessionId: "s1", configId: "model", value: "GLM-5.3" },
    })
  })

  it("新版那条发 set_model，字段名是 modelId", () => {
    expect(modelCall(undefined, "s1", "gpt-5.6")).toEqual({
      method: "session/set_model",
      params: { sessionId: "s1", modelId: "gpt-5.6" },
    })
  })

  it("一个模型都没有时不留路由——没得选就没得设", () => {
    expect(modelCatalogOf({ sessionId: "x" }).configId).toBeUndefined()
    expect(modelCatalogOf({ configOptions: [{ id: "model", options: [] }] }).configId).toBeUndefined()
  })
})

/**
 * 实测 ZCode：会话当前用的模型来自一个没启用的 provider 时，桥把它原样补进清单
 * （`anthropic\GLM-5.3`），名字却还是 `GLM-5.3`——下拉里于是两行一模一样，
 * 而其中一行点下去必然失败。
 */
describe("重名的模型要分得开", () => {
  it("**同名就把 id 带上**", () => {
    const session = {
      configOptions: [
        {
          id: "model",
          currentValue: "anthropic\\GLM-5.3",
          options: [
            { value: "anthropic\\GLM-5.3", name: "GLM-5.3" },
            { value: "GLM-5.3", name: "GLM-5.3" },
            { value: "GLM-5-Turbo", name: "GLM-5-Turbo" },
          ],
        },
      ],
    }
    const labels = modelCatalogOf(session).models.map((m) => m.label)
    expect(labels).toEqual(["GLM-5.3（anthropic\\GLM-5.3）", "GLM-5.3（GLM-5.3）", "GLM-5-Turbo"])
  })

  it("不重名的一个字都不动", () => {
    const session = { models: { availableModels: [{ modelId: "a", name: "A" }, { modelId: "b", name: "B" }] } }
    expect(modelCatalogOf(session).models.map((m) => m.label)).toEqual(["A", "B"])
  })
})

describe("失败要说人话", () => {
  it("Method not found 翻成「这家不支持」，并说下一步怎么办", () => {
    const said = sayWhy("acp:zcode", "换模型", new Error('"Method not found": session/set_model'))
    expect(said).toContain("不支持")
    expect(said).toContain("新开一条会话")
    // **不把协议原文摆给用户**：他看不出那是什么，也做不了什么
    expect(said).not.toContain("session/set_model")
  })

  it("**其余错误原样带出去**——编不出更好的话时，原文比编的话有用", () => {
    expect(sayWhy("kimi", "换模型", new Error("connection closed"))).toContain("connection closed")
  })
})

/**
 * **有的 agent 把强度放在模型清单的扩展位里**，而不是 `configOptions`。
 * 下面这份是实测 grok 的原文（`grok agent stdio` 的 `session/new` 回包）。
 * Switchback 原来只翻 `configOptions`，于是 grok 上一档都看不见——而它明明支持四档。
 */
describe("强度也可能在模型的扩展位里", () => {
  const grok = {
    models: {
      currentModelId: "grok-4.6",
      availableModels: [
        {
          modelId: "grok-4.6",
          name: "Grok 4.6",
          _meta: {
            totalContextTokens: 500000,
            supportsReasoningEffort: true,
            reasoningEffort: "high",
            reasoningEfforts: [
              { id: "deep", value: "xhigh", label: "Extra High Effort" },
              { id: "high", value: "high", label: "High Effort", default: true },
              { id: "low", value: "low", label: "Low Effort" },
            ],
          },
        },
      ],
    },
  }

  it("**上线的是 `value` 不是 `id`**——grok 自己的注释写着 id/label 只是展示", () => {
    expect(modelsOf(grok)[0]?.efforts).toEqual(["xhigh", "high", "low"])
  })

  it("当前那一档也带出来", () => {
    expect(modelsOf(grok)[0]?.defaultEffort).toBe("high")
  })

  it("**没有这个扩展位的模型不挂强度**——挂了就是一个点开是空的选择器", () => {
    expect(modelsOf({ models: { availableModels: [{ modelId: "a" }] } })[0]?.efforts).toBeUndefined()
    expect(
      modelsOf({ models: { availableModels: [{ modelId: "a", _meta: { reasoningEfforts: [] } }] } })[0]?.efforts,
    ).toBeUndefined()
  })

  it("清单里的项缺 `value` 就跳过那一项，不拿 `id` 顶替", () => {
    const odd = {
      models: { availableModels: [{ modelId: "a", _meta: { reasoningEfforts: [{ id: "x" }, { value: "low" }] } }] },
    }
    expect(modelsOf(odd)[0]?.efforts).toEqual(["low"])
  })
})
