import type { EngineThread } from "@omni/protocol"
import { FOREIGN_MAX } from "../sidebar.js"
import { SectionHead } from "./SidebarSections.js"
import { SIDEBAR_ICON_SMALL } from "./icon-base.js"
import { ForkIcon } from "./icons.js"

/**
 * 「codex 历史」段里的一行：**引擎自己存着、omni 从来不知道的那些会话**。
 *
 * ## 为什么长得和普通会话行不一样
 *
 * 它们能做的事完全不同：普通行点开就看见全部内容，这些行点开是**把会话接过来**
 * ——接过来之后 omni 这边的记录从零开始（codex 的 `thread/items/list` 目前
 * 回 `not supported yet`，历史内容取不回来）。
 *
 * 长得一样的话，用户会按普通会话的预期去点，然后看到一片空白，
 * 以为内容丢了。所以图标、副标题（哪个项目 + 什么时候）都不一样，
 * 而且不给右键菜单——改名、删除这些对一条不属于 omni 的会话没有意义。
 */
export function ForeignRow({
  item,
  onAdopt,
}: {
  item: EngineThread
  onAdopt: (item: EngineThread) => void
}): React.JSX.Element {
  return (
    <div className="row row--thread row--flat">
      <button
        type="button"
        className="row__main"
        title={`${item.cwd}\n在 omni 里接着聊（前面的内容在引擎那边）`}
        onClick={() => {
          onAdopt(item)
        }}
      >
        <span className="row__slot">
          <ForkIcon size={SIDEBAR_ICON_SMALL} />
        </span>
        <span className="row__label">{item.title}</span>
        <span className="row__aside">{whenOf(item.updatedAt)}</span>
      </button>
    </div>
  )
}

/**
 * 「什么时候」说成人话。
 *
 * 这一段里的会话是按时间找的（「我昨天在终端里跑的那个」），所以时间比
 * 精确的日期有用。**超过一周就给日期**——「12 天前」这种说法，
 * 人还得自己换算一次才知道是哪天。
 */
export function whenOf(at: number, now = Date.now()): string {
  if (at <= 0) return ""
  const mins = Math.floor((now - at) / 60000)
  if (mins < 1) return "刚刚"
  if (mins < 60) return `${String(mins)} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${String(hours)} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${String(days)} 天前`
  const d = new Date(at)
  return `${String(d.getMonth() + 1)}月${String(d.getDate())}日`
}

/**
 * 「codex 历史」段：**引擎自己存着、omni 从来不知道的那些会话**。
 *
 * 单独成段（而不是混进项目树）是因为它们能做的事完全不同：
 * 普通会话点开就看见全部内容，这些点开是**把会话接过来**，
 * 而接过来之后 omni 这边的记录从零开始。混在一起的话，
 * 用户会按普通会话的预期去点，然后看到一片空白。
 */
export function ForeignSection({
  engine,
  threads,
  open,
  onToggle,
  onAdopt,
}: {
  engine: string
  threads: readonly EngineThread[]
  open: boolean
  onToggle: () => void
  onAdopt: (engine: string, item: EngineThread) => void
}): React.JSX.Element {
  return (
    <>
      {/* **默认折叠**（见 `defaultOpen`）：这一段的条数由引擎决定，
          展开着会把你自己那几条挤下去 */}
      <SectionHead title={`${engine} 历史`} open={open} onToggle={onToggle} />
      {open ? (
        threads.length === 0 ? (
          // **说清楚为什么空**：历史是握手时问出来的，没开过这家就问不到。
          // 只写「暂无」的话，人会以为自己在别处跑的会话没被认出来
          <p className="sidebar__empty">
            在 omni 里开一个 {engine} 会话之后，你在终端或别处跑过的会列在这里。
          </p>
        ) : (
        <>
          {threads.map((item) => (
            <ForeignRow
              key={item.handle}
              item={item}
              onAdopt={(picked) => {
                onAdopt(engine, picked)
              }}
            />
          ))}
          {/* **截断要说出来。** 不说的话「就这些了」和「只给你看了这些」
              在界面上长得一模一样 */}
          {threads.length >= FOREIGN_MAX ? (
            <p className="sidebar__empty">只列最近 {FOREIGN_MAX} 条。更早的去 {engine} 里找。</p>
          ) : null}
        </>
        )
      ) : null}
    </>
  )
}
