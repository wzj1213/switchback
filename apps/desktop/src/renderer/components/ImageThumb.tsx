import { useEffect, useState } from "react"

/**
 * 图片缩略图 + 点开看大图。
 *
 * ## 为什么单独一个文件
 *
 * 两处要用：输入框上方那排待发附件、以及历史消息里已经发过的图。
 * 它们的**处境**不同（一个能删、一个不能），但「这张图长什么样」是同一件事——
 * 而上一版两处各写各的，结果是两处都只画了个文件名。
 *
 * ## 为什么不是 `<img src="file://…">`
 *
 * CSP 挡着（`img-src 'self' data:`），而为了显示缩略图放开 `file:`
 * 等于让渲染层能引用盘上任意路径。所以走 `omni:thumb` 通道，
 * 主进程缩好了给 data URL——顺带省掉了把整张原图搬进渲染层。
 */

/** 列表里那张小的。翻倍是为了 Retina，不然缩略图自己是糊的。 */
const THUMB_PX = 72 * 2
/** 点开之后那张大的。够看清一张截图上的字，又不至于把几 MB 搬进内存。 */
const FULL_PX = 2000

/**
 * 取一张图的 data URL。
 *
 * **「还没取到」和「取不到」必须分开。** 上一版两者都是 `undefined`，于是
 * 每张图在加载的那两百毫秒里都先显示一句「这张图打不开了」——成功路径上
 * 必然闪一次假话；小图那边还会从 36px 的文件名块跳到 72px 的图，
 * 整排附件当场往下顶 37.6px。
 *
 * `miss` 这一支是真的会到的：主进程那边取不到时明写「不抛，返回一张空图」。
 */
type Thumbnail = { state: "loading" } | { state: "ok"; url: string } | { state: "miss" }

function useThumb(path: string, max: number): Thumbnail {
  const [thumb, setThumb] = useState<Thumbnail>({ state: "loading" })
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.omni
    if (bridge === undefined) return undefined
    let live = true
    setThumb({ state: "loading" })
    void bridge.thumb(path, max).then((data) => {
      // 换了图之后回来的那次响应不能再往界面上写
      if (live) setThumb(data === undefined ? { state: "miss" } : { state: "ok", url: data })
    })
    return () => {
      live = false
    }
  }, [path, max])
  return thumb
}

/** 文件名。路径又长又是自动生成的，摆出来占满一行还什么都没说。 */
function nameOf(path: string): string {
  return path.split("/").pop() ?? path
}

export function Thumb({
  path,
  onRemove,
}: {
  path: string
  /** 给了就画一个角标的 ×。历史消息里的图删不掉，所以那边不给。 */
  onRemove?: (path: string) => void
}): React.JSX.Element {
  const thumb = useThumb(path, THUMB_PX)
  const [open, setOpen] = useState(false)
  return (
    <span className="thumb" title={nameOf(path)}>
      <button
        type="button"
        className="thumb__hit"
        aria-label={`预览 ${nameOf(path)}`}
        onClick={() => {
          setOpen(true)
        }}
      >
        {/* 占位块的尺寸和最终那张图**逐字一致**：不一致的话图一到位，
            整排附件连同下面的对话一起往下顶 */}
        {thumb.state === "loading" ? <span className="thumb__skel" aria-hidden="true" /> : null}
        {thumb.state === "miss" ? <span className="thumb__name">{nameOf(path)}</span> : null}
        {thumb.state === "ok" ? <img src={thumb.url} alt="" /> : null}
      </button>
      {onRemove === undefined ? null : (
        <button
          type="button"
          className="thumb__drop"
          aria-label="去掉这个附件"
          onClick={() => {
            onRemove(path)
          }}
        >
          ×
        </button>
      )}
      {open ? (
        <Lightbox
          path={path}
          onClose={() => {
            setOpen(false)
          }}
        />
      ) : null}
    </span>
  )
}

/**
 * 全屏看图。Esc 关、点背景也关。
 *
 * 键盘监听挂在 `window` 而不是这个节点上：点开之后焦点还在输入框里，
 * 挂在节点上的话按 Esc 根本收不到。
 */
function Lightbox({ path, onClose }: { path: string; onClose: () => void }): React.JSX.Element {
  const full = useThumb(path, FULL_PX)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return
      // 挡住：不然这一下会穿透到输入框那层，把命令面板一起关了
      e.stopPropagation()
      onClose()
    }
    window.addEventListener("keydown", onKey, { capture: true })
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true })
    }
  }, [onClose])

  return (
    <div
      className="lightbox"
      role="presentation"
      onClick={() => {
        onClose()
      }}
    >
      {full.state === "loading" ? <span className="lightbox__miss">正在打开…</span> : null}
      {full.state === "miss" ? <span className="lightbox__miss">这张图打不开了：{path}</span> : null}
      {full.state === "ok" ? <img src={full.url} alt={nameOf(path)} /> : null}
    </div>
  )
}
