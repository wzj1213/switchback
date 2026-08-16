/**
 * 排在后面等着发的那几句。
 *
 * ## 为什么一定要显示出来
 *
 * 打完回车就消失的话，人会以为**发出去了**——而它其实还躺在队列里。
 * 等这一轮跑完它才动，中间这段时间界面上必须有它的位置，
 * 否则「我刚才是不是没发出去」这个疑问会一直挂着。
 *
 * ## 为什么能撤
 *
 * 排队的那句是**还没发生的事**，而人改主意的窗口恰恰在这段时间里
 *（看着 agent 跑，发现它其实做对了，那句纠正就不必发了）。
 * 撤回不是额外功能，是排队这件事成立的前提。
 */
export function Queued({ texts, onDrop }: { texts: readonly string[]; onDrop: () => void }): React.JSX.Element | null {
  if (texts.length === 0) return null
  return (
    <div className="queued">
      <span className="queued__badge">排队中 {texts.length}</span>
      <span className="queued__text" title={texts.join("\n")}>
        {texts[0]}
      </span>
      <button type="button" className="queued__drop" onClick={onDrop}>
        撤回
      </button>
    </div>
  )
}
