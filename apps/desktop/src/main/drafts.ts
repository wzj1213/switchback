import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { blankDraft, parseDrafts, pruneDrafts, type LoadedDrafts, type StoredDraft } from "../shared/drafts.js"
import type { Logger } from "./log.js"
import type { Channels } from "./channels.js"

/**
 * 输入框里没发出去的话，存在数据目录的 `drafts.json`：每条会话一份，另留「新会话」一格
 *（为什么见 shared `drafts.ts` 的 `NEW_DRAFT`）。
 *
 * ## 只由主进程写
 *
 * 渲染层每次改动经 IPC 交过来（它自己先攒一小会儿），这里再攒 300ms 落盘——写临时文件再改名，
 * 写到一半断电不会留下半份；退出前补写一次。几个窗口开着同一条会话时，后写的为准。
 *
 * ## 为什么不放 localStorage
 *
 * 它是同步接口、容量只有几 MB，一段大粘贴就能撑满；更要紧的是主进程读不到它——
 * 孤儿图片清理就认不出草稿里的图，七天后照删（见 `attachment-files.ts` 的 `hold`）。
 *
 * ## 为什么不放进会话记录
 *
 * 临时会话按设计不落盘；每敲一个字都改一次会话记录，还会一路推到手机上；
 * `Thread.draft` 已经给「取回」用了，发送时按版本号消费，混在一起会清错。
 */
export interface DraftStore {
  /** 现在存着的全部，外加启动读盘时发现已经不在了的附件数（只报一次）。 */
  load: () => LoadedDrafts
  /** 存一份；不给（或者是空的）就是删。 */
  save: (key: string, draft: StoredDraft | undefined) => void
  /** 会话删了：它的草稿一起删。 */
  forget: (key: string) => void
  /** 攒着的立刻落盘。退出时调。 */
  flush: () => void
}

interface Deps {
  file: string
  /** 草稿里的图算「在用」：见 `AttachmentFiles.hold`。 */
  hold: (owner: string, paths: readonly string[]) => void
  log: Logger
  exists?: (path: string) => boolean
  delayMs?: number
}

const ownerOf = (key: string): string => `draft:${key}`

function readFile(file: string, log: Logger): Record<string, StoredDraft> {
  try {
    return parseDrafts(JSON.parse(readFileSync(file, "utf8")) as unknown)
  } catch (error) {
    // 没有这个文件是常态（第一次启动、从没留过草稿），不记日志
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") log.write("warn", "drafts", `读不出 drafts.json：${String(error)}`)
    return {}
  }
}

/** 读盘时核一遍附件还在不在：不在的拿掉、数出来，交给输入框说一声。 */
function verify(drafts: Record<string, StoredDraft>, exists: (path: string) => boolean): LoadedDrafts {
  const missing: Record<string, number> = {}
  const checked = Object.entries(drafts).map(([key, draft]) => {
    const attachments = draft.attachments.filter((path) => exists(path))
    if (attachments.length < draft.attachments.length) missing[key] = draft.attachments.length - attachments.length
    return [key, { ...draft, attachments }] as const
  })
  return { drafts: Object.fromEntries(checked), missing }
}

export function createDraftStore(deps: Deps): DraftStore {
  const first = verify(readFile(deps.file, deps.log), deps.exists ?? existsSync)
  const state = {
    drafts: new Map(Object.entries(first.drafts)),
    missing: first.missing as LoadedDrafts["missing"],
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    // 删掉的会话：渲染层攒着的那一份可能晚一步才到，不能让它把草稿建回来
    gone: new Set<string>(),
  }
  for (const [key, draft] of state.drafts) deps.hold(ownerOf(key), draft.attachments)

  const write = (): void => {
    if (state.timer === undefined) return
    clearTimeout(state.timer)
    state.timer = undefined
    try {
      const temporary = `${deps.file}.tmp`
      writeFileSync(temporary, JSON.stringify(Object.fromEntries(state.drafts)), "utf8")
      renameSync(temporary, deps.file)
    } catch (error) {
      // 存不下就存不下：草稿丢了可惜，但绝不能因此掀翻应用
      deps.log.write("warn", "drafts", `写不进 drafts.json：${String(error)}`)
    }
  }
  const put = (key: string, draft: StoredDraft | undefined): void => {
    const before = [...state.drafts.keys()]
    state.drafts.delete(key)
    if (draft !== undefined && !blankDraft(draft)) state.drafts.set(key, draft)
    state.drafts = new Map(Object.entries(pruneDrafts(Object.fromEntries(state.drafts))))
    // 删掉的、挤出去的那几份也要放手，不然它们的图一直被当成在用
    for (const gone of before.filter((one) => !state.drafts.has(one))) deps.hold(ownerOf(gone), [])
    deps.hold(ownerOf(key), state.drafts.get(key)?.attachments ?? [])
    state.timer ??= setTimeout(write, deps.delayMs ?? 300)
  }

  return {
    load: () => {
      const loaded = { drafts: Object.fromEntries(state.drafts), missing: state.missing }
      state.missing = {}
      return loaded
    },
    save: (key, draft) => {
      if (!state.gone.has(key)) put(key, draft)
    },
    forget: (key) => {
      state.gone.add(key)
      if (state.drafts.has(key)) put(key, undefined)
    },
    flush: write,
  }
}

/** 键只认像会话 id 那样的短串；渲染层是自己人，但这条路不该被一个怪键写坏整份文件。 */
function keyOf(raw: unknown): string | undefined {
  return typeof raw === "string" && raw !== "" && raw.length <= 200 && raw !== "__proto__" ? raw : undefined
}

/** 渲染层读写草稿的通道。 */
export function installDraftsChannel(store: DraftStore, channels: Channels): void {
  channels.handle("switchback:drafts/load", () => store.load())
  channels.on("switchback:drafts/save", (value: unknown) => {
    const payload = (typeof value === "object" && value !== null ? value : {}) as { key?: unknown; draft?: unknown }
    const key = keyOf(payload.key)
    if (key === undefined) return
    // 交过来的那份同样逐字段核：认不出的当删
    store.save(key, parseDrafts({ [key]: payload.draft })[key])
  })
}
