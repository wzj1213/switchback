import { useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { ChevronIcon } from "./icons.js"

/**
 * 太长的那条收起来，底下给一颗「显示更多」。
 *
 * ## 为什么只对**你自己发的话**做
 *
 * 粘一整份日志、一大段报错、一个 PRD 进输入框是常事——那条消息在转录区里
 * 能铺满两三屏，而它下面的回答（你真正要读的东西）被推到看不见的地方。
 * 回答不做：回答本来就是要读的，收起来等于把主体藏了。
 *
 * ## 判据是**量出来的高度**，不是字数
 *
 * 一千个汉字和一千个换行占的高度差十倍。字数只能猜，而这里要回答的是
 * 「它在屏幕上是不是太高了」——那只有排完版才知道。所以量 `scrollHeight`，
 * 并且**留一档余量**：只高出一点点就收起来，那颗按钮点开只多出两行，
 * 白让人点一下。
 */

/** 收起来时最多留多高（px）。约十行，够看清这段是什么，不够读完。 */
export const CLAMP_MAX = 264
/** 高出这个数才值得收。见上：只多两行的不收。 */
const SLACK = 72

/** 这段要不要收起来。**纯函数**，边界（正好等于、还没量出来）用一张表钉住。 */
export function needsClamp(scrollHeight: number, max = CLAMP_MAX, slack = SLACK): boolean {
  return scrollHeight > max + slack
}

export function Clamped({ children }: { children: React.ReactNode }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(false)
  const [open, setOpen] = useState(false)
  // 内容会长高（流式、图片加载完、窗口变窄导致折行变多），所以盯着量而不是量一次。
  //
  // **只在 ResizeObserver 里量，挂载时不同步量一次。** observe 之后本来就会回调一次，
  // 那时排版刚算完，读 `scrollHeight` 不花钱；挂载时当场读则会逼浏览器先把整段
  // 转录区排一遍——长会话分片补齐时每片都付这一次，实测累计上百毫秒。
  // 屏外的行（content-visibility 跳过）不排版也就不回调，看得见时才量。
  // `flushSync`：回调在绘制之前，同一帧里收起，长消息不会先整段露一帧再缩回去。
  useEffect(() => {
    const node = box.current
    if (node === null) return undefined
    const measure = (): void => {
      flushSync(() => { setTall(needsClamp(node.scrollHeight)) })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [])
  return (
    <>
      <div className="clamp" ref={box} data-clamped={tall && !open}>
        {children}
      </div>
      {/* 不长就不画那颗按钮——一颗点开只多出两行的「显示更多」是在浪费一次点击 */}
      {tall ? (
        <button
          type="button"
          className="clamp__more"
          aria-expanded={open}
          onClick={() => {
            setOpen((was) => !was)
          }}
        >
          {open ? "收起" : "显示更多"}
          <ChevronIcon open={open} size={13} />
        </button>
      ) : null}
    </>
  )
}
