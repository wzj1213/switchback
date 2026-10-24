import { createInterface } from "node:readline"
import type { TurnId } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { localeOf } from "../locale.js"
import { createProcessOwner } from "../subprocess.js"
import { turnArgs, type TurnOptions } from "./options.js"
import { outcome, record, text, TurnStream, type Outcome } from "./translate.js"
import { AGY_TURN } from "./turn.messages.js"

export interface TurnRequest extends TurnOptions {
  command: string
  prompt: string
  turnId: TurnId
  onHandle: (handle: string) => void
  onFinish: () => void
}

/** 每轮一个原生进程，stdin EOF 让它完成当前轮后退出；续聊只用精确 conversation ID。 */
export class AntigravityTurn {
  private readonly owner = createProcessOwner({ exitGraceMs: 0 })
  private readonly stream: TurnStream
  private result: Outcome | undefined
  private stderr = ""
  private failure: string | undefined
  private interrupted = false
  private finished = false
  private resolve: () => void = () => undefined
  readonly done: Promise<void>

  constructor(private readonly req: StartRequest, private readonly input: TurnRequest) {
    this.stream = new TurnStream(req, input.turnId)
    this.done = new Promise((resolve) => { this.resolve = resolve })
  }

  start(): void {
    const child = this.owner.spawn({ command: this.input.command, args: turnArgs(this.input), cwd: this.req.cwd })
    const { stdin, stdout, stderr } = child
    if (stdin === null || stdout === null || stderr === null) throw new Error(AGY_TURN[localeOf(this.req)].noPipes)
    const lines = createInterface({ input: stdout, crlfDelay: Infinity })
    lines.on("line", (line) => this.line(line))
    stderr.setEncoding("utf8").on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-32_768)
    })
    // EPIPE/ENOENT 必须由本轮接住；不能变成 Electron 主进程的未捕获异常。
    stdin.on("error", (error: Error) => { this.failure ??= error.message })
    child.on("close", (code, signal) => { void this.finish(code, signal) })
    stdin.end(`${JSON.stringify({ event: "user", message: { content: this.input.prompt } })}\n`)
  }

  pid(): number | undefined { return this.owner.pid() }

  async interrupt(): Promise<void> {
    if (this.finished) return this.done
    this.interrupted = true
    const report = await this.owner.reclaim()
    if (report.rung === "escaped") throw new Error(AGY_TURN[localeOf(this.req)].stuck)
    await this.done
  }

  private line(line: string): void {
    if (line.trim() === "") return
    try {
      const frame = record(JSON.parse(line) as unknown)
      if (frame.event === "init") this.init(frame)
      if (frame.event === "step_update") this.stream.step(record(frame.step_update))
      if (frame.event === "result") this.resultOf(record(frame.result))
    } catch (error) {
      this.failure = AGY_TURN[localeOf(this.req)].unparseable(error instanceof Error ? error.message : String(error))
      void this.owner.reclaim()
    }
  }

  private init(frame: Record<string, unknown>): void {
    const handle = text(frame.conversation_id)
    if (handle !== undefined) this.input.onHandle(handle)
    const init = record(frame.init)
    const permission = text(init.permission_mode)
    const model = text(init.model)
    this.req.onEngineState?.({
      ...(model === undefined ? {} : { modelId: model }),
      ...(permission === undefined ? {} : { axes: [{ axis: "permission", id: permission, match: "unknown" }] }),
    })
  }

  private resultOf(result: Record<string, unknown>): void {
    const handle = text(result.conversation_id)
    if (handle !== undefined) this.input.onHandle(handle)
    const next = outcome(result, localeOf(this.req))
    if (next === undefined) return
    this.result = next
    this.stream.response(result.response)
  }

  private async finish(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (this.finished) return
    this.finished = true
    const report = await this.owner.reclaim()
    const result = this.finalResult(code, signal)
    if (report.rung === "escaped") {
      result.status = "failed"
      result.error = AGY_TURN[localeOf(this.req)].leftover
    }
    this.stream.finish(result.status)
    if (this.stderr.trim() !== "") this.notice(this.stderr.trim())
    this.input.onFinish()
    this.req.emit({ type: "turn.completed", at: Date.now(), turnId: this.input.turnId, ...result })
    this.resolve()
  }

  private finalResult(code: number | null, signal: NodeJS.Signals | null): Outcome {
    if (this.interrupted && this.result === undefined) return { status: "interrupted" }
    const error = this.owner.failure()?.message ?? this.failure
    if (error !== undefined) return { status: "failed", error: this.stderr.trim() || error }
    if (this.result !== undefined) return this.result
    return { status: "failed", error: this.stderr.trim() ||
      AGY_TURN[localeOf(this.req)].noResult(String(code), signal ?? undefined) }
  }

  private notice(message: string): void {
    this.req.emit({ type: "item.started", at: Date.now(), item: {
      id: `agy:${this.input.turnId}:stderr`, turnId: this.input.turnId, at: Date.now(),
      kind: "notice", level: "info", message,
    } })
  }
}
