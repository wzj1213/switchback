import type { EngineInfo, EngineSegment, Thread } from "@switchback/protocol"
import { Popover } from "./Popover.js"
import { CopyIcon, RevealIcon } from "./icons.js"
import { engineTint } from "../engine-mark.js"
import { labelOf } from "./Composer.js"

/**
 * 「这条会话都被谁跑过」——一条时间线答完。
 *
 * ## 为什么需要它
 *
 * 一条会话可以在几家引擎之间来回切：codex 跑三轮、切 Claude 看一眼、再切回 codex。
 * 每一家在自己那边都留着一条**独立的**会话记录，而 Switchback 这边看不到它们的存在——
 * 于是「刚才那段 Claude 的 review 记在哪儿」只能靠猜。
 *
 * 这张卡片把它们摆出来：谁、句柄（可复制，拿去引擎自己的界面里也翻得到）、
 * 原始记录在磁盘的哪儿（可复制、可在访达里定位）。
 *
 * ## 为什么默认不显示
 *
 * 和环境卡片同一个理由：这些字一天看不了两回，而右栏要占掉一条常驻的宽度。
 * 平时它不该在。
 *
 * ## 为什么「切了引擎但没说话」不留记录
 *
 * 段是在**第一轮开始时**才落的（见 `prompt.ts` 的 `recordSegment`）。
 * 切过去点错了又切回来，时间线上不该多一条什么都没发生的记录——
 * 那种记录多了，这张卡片就从「发生过什么」变成「我点过什么」。
 */
export function TimelineCard({
  thread,
  engines,
  anchor,
  onClose,
  onCopy,
  onReveal,
}: {
  thread: Thread
  /** 引擎清单：把 id 翻成人话。这张卡以前直接印 `codex`，那是给机器读的名字 */
  engines: readonly EngineInfo[]
  anchor: HTMLElement | null
  onClose: () => void
  onCopy: (text: string) => void
  onReveal: (path: string) => void
}): React.JSX.Element {
  const segments = thread.segments ?? []
  return (
    <Popover open anchor={anchor} minWidth={420} ariaLabel="引擎时间线" onClose={onClose}>
      <div className="card">
        <div className="card__head">引擎时间线</div>
        {segments.length === 0 ? (
          // **说清为什么空**，别只写「暂无」：人会以为功能坏了
          <p className="card__empty">
            还没有跑过。说一句话之后，这里会记下是哪家引擎跑的、记录在哪。
          </p>
        ) : (
          segments.map((seg, i) => (
            <Segment
              // **时刻要进 key**：同一家可能出现好几段（切出去又切回来），
              // 那几段的引擎、profile、句柄全一样，只有接手的时刻不同
              key={`${seg.engine}-${seg.profile ?? ""}-${seg.handle}-${String(seg.startedAt)}`}
              seg={seg}
              index={i + 1}
              label={labelOf(engines, seg.engine)}
              onCopy={onCopy}
              onReveal={onReveal}
            />
          ))
        )}
      </div>
    </Popover>
  )
}

function Segment({
  seg,
  index,
  label,
  onCopy,
  onReveal,
}: {
  seg: EngineSegment
  index: number
  /** 这家引擎的人话名。 */
  label: string
  onCopy: (text: string) => void
  onReveal: (path: string) => void
}): React.JSX.Element {
  return (
    <div className="seg">
      <div className="seg__head">
        <span className="seg__no">{index}</span>
        {/* 引擎色那颗点。和转录区那条分界、左缘导航是同一套色——
            三处对得上，「这一段是谁跑的」才连得成一句话 */}
        <i className="handmark__dot" style={{ background: engineTint(seg.engine) }} aria-hidden="true" />
        <span className="seg__engine">
          {label}{seg.profile === undefined ? "" : ` · ${seg.profile}`}
        </span>
        <span className="seg__when">{whenOf(seg.startedAt)}</span>
      </div>
      <Line label="会话 id" value={seg.handle} onCopy={onCopy} />
      {seg.logPath === undefined ? (
        // 拿不到就明说。留空的话，人会以为是自己没找对地方
        <p className="seg__none">这家引擎没有提供本地记录的路径。</p>
      ) : (
        <Line label="记录" value={seg.logPath} onCopy={onCopy} onReveal={onReveal} />
      )}
    </div>
  )
}

/** 一行「标签 + 值 + 复制」。值用等宽并允许换行——句柄和路径都长且要能看全。 */
function Line({
  label,
  value,
  onCopy,
  onReveal,
}: {
  label: string
  value: string
  onCopy: (text: string) => void
  onReveal?: (path: string) => void
}): React.JSX.Element {
  return (
    <div className="seg__line">
      <span className="seg__label">{label}</span>
      <code className="seg__value">{value}</code>
      <button
        type="button"
        className="iconbtn"
        aria-label={`复制${label}`}
        title="复制"
        onClick={() => {
          onCopy(value)
        }}
      >
        <CopyIcon size={13} />
      </button>
      {onReveal === undefined ? null : (
        <button
          type="button"
          className="iconbtn"
          aria-label="在访达中显示"
          title="在访达中显示"
          onClick={() => {
            onReveal(value)
          }}
        >
          <RevealIcon size={13} />
        </button>
      )}
    </div>
  )
}

/** 什么时候开始的。这张卡片是回看用的，日期比「几分钟前」更有用。 */
function whenOf(at: number): string {
  if (at <= 0) return ""
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, "0")
  return `${String(d.getMonth() + 1)}月${String(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}
