import type { Attached } from "../host.js"
import { rebuild } from "../host.js"
import type { createSinks } from "../sink.js"
import { REMOTE_BUDGETS, bodyOf, withCurrent } from "../scope.js"
import type { Channels } from "../channels.js"
import { installRemote } from "./install.js"
import type { Logger } from "../log.js"
import type { Settings } from "../../shared/settings.js"

/**
 * 浏览器端的服务端。**默认关着**，开关在设置里；开了也只 listen 回环，
 * 要从外面进来得自己开隧道（见 `docs/手机端远程方案.md`）。
 *
 * 命令走的是**和 IPC 完全同一条路**（`host.dispatch` + 同一个 `report`）——
 * 摆两份实现的下场是其中一份迟早不更新，而那份正好是用户在外面用的那份。
 */
export function attachRemote(deps: {
  attached: Attached
  sinks: ReturnType<typeof createSinks>
  settings: () => Settings
  /** 通道登记表（`main/channels.ts`）。「电脑」设备按名字从这里找处理函数。 */
  channels: Pick<Channels, "find">
  log: Logger
}): ReturnType<typeof installRemote> {
  const { attached, sinks, log } = deps
  return installRemote({
    settings: deps.settings,
    ledger: attached.ledger,
    sinks,
    dispatch: (command) => {
      void attached.host.dispatch(command).catch((error: unknown) => {
        attached.report(error, "threadId" in command ? command.threadId : undefined)
      })
    },
    replay: async (sink, kind) => {
      // **远程那条给预算**：同机 IPC 上一份几 MB 的全量只是一次结构化克隆，
      // 而在蜂窝网上那是十几秒的「正在连接…」。电脑那组比手机宽（见 `REMOTE_BUDGETS`）
      await rebuild(attached, sink, REMOTE_BUDGETS[kind])
    },
    // 档位上限要管得住**已经开着的**会话，所以得能查到它现在是哪一档；
    // 历史会话（背后没有进程）按记录里那一档——发话会按它接回来（见 `thread-trust.ts`）
    trustOf: (threadId) =>
      attached.host.live().find((t) => t.id === threadId)?.trust ?? attached.threadTrust.of(threadId),
    // **先把在途写入落完再读。** 宿主发事件不等落盘，所以「发出去了」和
    // 「在文件里了」之间有个窗口；在窗口里读到的是缺一截的一份，而客户端
    // 收到它之后只会按 item id 去重——缺的那几条不会再补回来。
    // `rebuild` 早就这么做了，这条路当时漏了
    history: async (threadId, kind) => {
      await attached.journal.flush().catch(() => undefined)
      const events = await attached.journal.read(threadId)
      // **单独补也要封顶。** 一条 2.5 MB 的会话单发一份同样是几百个分片，
      // 手机上同样收不完——分级省下来的会在这一步原样还回去
      const body = bodyOf({ id: threadId, events }, REMOTE_BUDGETS[kind].thread)
      if (body.trimmed) log.write("info", "remote", `${threadId} 的正文太长，只补了尾巴`)
      // **结尾用当前状态收口**，规则和全量那条路一样：磁盘上那份是上次落盘的样子，
      // 客户端照着它重建这条会话，会把一条正在跑的改回 idle、把改过的名字改回去
      const live = attached.host.live().find((t) => t.id === threadId)
      return { events: withCurrent(body.events, live, Date.now()), trimmed: body.trimmed }
    },
    channel: deps.channels.find,
    log,
  })
}
