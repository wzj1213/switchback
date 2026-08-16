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
 * 取不到就是 `undefined`——**调用方据此退回显示文件名，而不是画个破框**。
 * 文件被删了、或者附件根本不是图片（将来可能允许贴别的），都会走到这条路上。
 */
function useThumb(path: string, max: number): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.omni
    if (bridge === undefined) return undefined
    let live = true
    void bridge.thumb(path, max).then((data) => {
      // 换了图之后回来的那次响应不能再往界面上写
      if (live) setUrl(data)
    })
    return () => {
      live = false
    }
  }, [path, max])
  return url
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
  const url = useThumb(path, THUMB_PX)
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
        {url === undefined ? <span className="thumb__name">{nameOf(path)}</span> : <img src={url} alt="" />}
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
  const url = useThumb(path, FULL_PX)
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
      {url === undefined ? (
        <span className="lightbox__miss">这张图打不开了：{path}</span>
      ) : (
        <img src={url} alt={nameOf(path)} />
      )}
    </div>
  )
}
