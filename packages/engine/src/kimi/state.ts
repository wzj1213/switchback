import type { ModelOption, Trust } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { trustAxes } from "./trust.js"
import type { KimiEventUsage, KimiPayload, KimiStatus, KimiUsage } from "./wire.js"

function totalOf(usage: KimiEventUsage | undefined): number | undefined {
  const total = usage?.total
  if (total === undefined) return undefined
  return total.inputOther + total.inputCacheRead + total.inputCacheCreation + total.output
}

function persistedTotal(usage: KimiUsage | undefined): number | undefined {
  if (usage === undefined) return undefined
  return usage.input_tokens + usage.output_tokens + usage.cache_read_tokens + usage.cache_creation_tokens
}

/** 事件负载里的缓存命中。只取 read——creation 是写缓存，不是命中；没报就是 undefined。 */
function cacheReadOf(usage: KimiEventUsage | undefined): number | undefined {
  return usage?.total?.inputCacheRead
}

export class KimiStateReporter {
  private options: readonly ModelOption[] = []

  constructor(
    private readonly req: StartRequest,
    private readonly trust: () => Trust,
  ) {}

  setOptions(options: readonly ModelOption[]): void {
    this.options = options
  }

  private effort(model: string | undefined, effort: string | undefined): string | undefined {
    if (model === undefined || effort === undefined) return undefined
    return this.options.find((option) => option.id === model)?.efforts?.includes(effort) === true ? effort : undefined
  }

  status(status: KimiStatus): void {
    const model = status.model === "" ? undefined : status.model
    const effort = this.effort(model, status.thinking_level)
    const axes = trustAxes(status, this.trust())
    if (model !== undefined || effort !== undefined) this.req.onModel?.(model, effort)
    if (axes.length > 0 || model !== undefined) {
      this.req.onEngineState?.({ axes, ...(model === undefined ? {} : { modelId: model }) })
    }
    if (status.context_tokens !== undefined) {
      this.req.emit({
        type: "usage.updated",
        at: Date.now(),
        threadId: this.req.threadId,
        engine: "kimi",
        usage: {
          contextUsed: status.context_tokens,
          ...(status.max_context_tokens === undefined ? {} : { contextWindow: status.max_context_tokens }),
        },
      })
    }
  }

  event(payload: KimiPayload): void {
    const status: KimiStatus = {
      busy: true,
      ...(payload.model === undefined ? {} : { model: payload.model }),
      ...(payload.thinkingEffort === undefined ? {} : { thinking_level: payload.thinkingEffort }),
      ...(payload.permission === undefined ? {} : { permission: payload.permission }),
      ...(payload.planMode === undefined ? {} : { plan_mode: payload.planMode }),
      ...(payload.contextTokens === undefined ? {} : { context_tokens: payload.contextTokens }),
      ...(payload.maxContextTokens === undefined ? {} : { max_context_tokens: payload.maxContextTokens }),
    }
    this.status(status)
    const totalTokens = totalOf(payload.usage)
    if (payload.contextTokens === undefined || totalTokens === undefined) return
    this.req.emit({
      type: "usage.updated",
      at: Date.now(),
      threadId: this.req.threadId,
      engine: "kimi",
      usage: {
        contextUsed: payload.contextTokens,
        ...(payload.maxContextTokens === undefined ? {} : { contextWindow: payload.maxContextTokens }),
        totalTokens,
        ...(cacheReadOf(payload.usage) === undefined ? {} : { cacheRead: cacheReadOf(payload.usage) }),
      },
    })
  }

  persisted(usage: KimiUsage | undefined): void {
    if (usage === undefined) return
    this.req.emit({
      type: "usage.updated",
      at: Date.now(),
      threadId: this.req.threadId,
      engine: "kimi",
      usage: {
        contextUsed: usage.context_tokens,
        ...(usage.context_limit <= 0 ? {} : { contextWindow: usage.context_limit }),
        ...(persistedTotal(usage) === undefined ? {} : { totalTokens: persistedTotal(usage) }),
        // 缓存命中只取 read——creation 是写缓存，不是命中
        ...(usage.cache_read_tokens <= 0 ? {} : { cacheRead: usage.cache_read_tokens }),
      },
    })
  }
}
