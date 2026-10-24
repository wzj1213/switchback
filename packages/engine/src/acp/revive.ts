import type { RpcPeer } from "../rpc.js"
import type { Locale } from "@switchback/i18n"
import { localeOf } from "../locale.js"
import { ACP_REVIVE } from "./revive.messages.js"

/**
 * 会话睡着了：重新挂上，让这一轮重发一次。
 *
 * ## 这条是实测逼出来的
 *
 * ZCode 上跑着跑着，每一次发送都变成同一堵墙（实测 mac2）：
 *
 * ```
 * Internal error：session/subscribe failed: Session is not active: sess_5ff6cd36-… (code -32004)
 * ```
 *
 * 那句话不是 Switchback 说的——Switchback 对 ACP 只发 `session/{new,load,fork,prompt,steer,cancel,
 * compact,list,set_mode,set_model,set_config_option}`，**没有 `subscribe`**。
 * 是桥在替我们跟后端说话时挂了，Switchback 只是把 `data.details` 原样转出来。
 *
 * 关键是拿那个句柄去 `session/load` **成功了**——它只是睡着了，不是没了。
 * ZCode 自己也分得清这两句：不活跃是 `Session is not active`，
 * 真没了是 `Session not found`。所以这一层做的事很简单：
 * **认出「睡着了」，挂回来，重发一次。** 挂不回来就把两条原因一起说出去。
 *
 * ## 为什么必须挡住重放
 *
 * `session/load` 会把**整段历史**重放成 `session/update`（实测 ZCode：213 条）。
 * 这在**开场续跑**时是无害的——那时 `state.turn` 还是 undefined，而 `update.ts`
 * 里每条都写着 `if (turnId === undefined) return`，于是重放自然被丢掉。
 * 但**中途重挂时 `state.turn` 正指着这一轮**：不挡的话 213 条历史会原样灌进
 * 你刚发的那句话下面。
 *
 * ## 为什么要「等它安静」而不是「等回包」
 *
 * 实测这 213 条里 **210 条在回包之前、3 条在回包之后**——ACP 没有
 * 「重放到此结束」的标记，回包也不是那条线。所以只能等它不说话：
 * 连续 `QUIET_MS` 没有新的 update 就当重放完了，最多等 `MAX_MS`。
 *
 * 这个窗口里丢掉 update 是安全的：这一轮的 prompt **根本没被引擎接住**
 *（它就是失败在那一步），所以此刻不可能有属于这一轮的实时内容。
 * 闸门在**重发之前**就关上了。
 */

/** 连续这么久没有新 update，就当重放结束了。 */
const QUIET_MS = 400

/** 再吵也不等了。等不完就往下走——重发一次的价值大于这几条脏数据。 */
const MAX_MS = 5000

const TICK_MS = 100

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 「睡着了」的判据。
 *
 * **两种都收**：`not active` 挂得回来，`not found` 挂不回来——但后者走同一条路
 * 反而更好，`session/load` 会把「真没了」这件事明确报出来，比让用户对着
 * 一句 `session/subscribe failed` 反复重发强。分辨留给结果，不留给正则。
 */
const ASLEEP = /session\s+(?:is\s+)?not\s+(?:active|found)/i

export function isAsleep(message: string): boolean {
  return ASLEEP.test(message)
}

/**
 * 重挂要读的那几样，**结构化声明**——驱动的 `SessionState` 天然满足它。
 *
 * 直接拿这个活对象、不拆成六个闭包，也不在构造时快照：**句柄会变**
 *（换模型、分叉、续跑都会换掉 `acpSession`），快照下来的那一份下一秒就是旧的。
 */
export interface ReviveState {
  acpSession: string | undefined
  loadSession: boolean
  native: { meta?: Readonly<Record<string, unknown>> | undefined } | undefined
}

export class SessionRevive {
  private active = false
  private lastAt = 0

  constructor(
    /** 引擎 id、工作区、以及挂不回来时那句话用哪种语言。 */
    private readonly who: { id: string; cwd: string; locale?: () => Locale },
    private readonly rpc: Pick<RpcPeer, "call">,
    private readonly state: ReviveState,
  ) {}

  /** 重放期间为真：`driver` 据此把 `session/update` 整个丢掉。 */
  get replaying(): boolean {
    return this.active
  }

  /** 重放期里每来一条 update 记一下时刻——「安静」是靠它算的。 */
  saw(): void {
    this.lastAt = Date.now()
  }

  async run(): Promise<void> {
    const handle = this.state.acpSession
    if (handle === undefined) throw new Error(ACP_REVIVE[localeOf(this.who)].noHandle(this.who.id))
    if (!this.state.loadSession) throw new Error(ACP_REVIVE[localeOf(this.who)].noLoad(this.who.id))
    this.active = true
    this.lastAt = Date.now()
    try {
      const meta = this.state.native?.meta
      await this.rpc.call("session/load", {
        sessionId: handle,
        cwd: this.who.cwd,
        mcpServers: [],
        ...(meta === undefined ? {} : { _meta: meta }),
      })
      await this.settle()
    } finally {
      this.active = false
    }
  }

  private async settle(): Promise<void> {
    const giveUp = Date.now() + MAX_MS
    for (;;) {
      await sleep(TICK_MS)
      if (Date.now() >= giveUp) return
      if (Date.now() - this.lastAt >= QUIET_MS) return
    }
  }
}
