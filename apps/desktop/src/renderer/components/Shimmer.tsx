/**
 * 有节拍的微光文字。
 *
 * **不是一刻不停地扫**，而是隔几秒扫一道。
 * 一直动的加载动画会持续抢注意力，等待越久越烦躁；隔一段扫一次既证明"还活着"，
 * 又不至于一直在余光里晃。
 *
 * 实现上是两层反向位移：外层遮罩带右移、内层文字左移同样的量，
 * 于是文字在屏幕上纹丝不动，只有那条高亮窗口在扫过去。
 * 位移与节拍全在 CSS 里（见 `status.css`），没有 JS 定时器——
 * 定时器在这里只会带来一堆需要清理的生命周期。
 */
export function Shimmer({ text }: { text: string }): React.JSX.Element {
  return (
    <span className="shimmer">
      {text}
      <span className="shimmer__sweep" aria-hidden="true">
        <span className="shimmer__hi">{text}</span>
      </span>
    </span>
  )
}
