/**
 * 排在后面等着发的那几句。
 *
 * ## 为什么一定要显示出来
 *
 * 打完回车就消失的话，人会以为**发出去了**——而它其实还躺在队列里。
 * 等这一轮跑完它才动，中间这段时间界面上必须有它的位置，
 * 否则「我刚才是不是没发出去」这个疑问会一直挂着。
 *
 * ## 为什么能撤，以及撤回**必须把话放回输入框**
 *
 * 排队的那句是**还没发生的事**，而人改主意的窗口恰恰在这段时间里
 *（看着 agent 跑，发现它其实做对了，那句纠正就不必发了）。
 * 撤回不是额外功能，是排队这件事成立的前提。
 *
 * 但「撤回」的意思是**这句先别发**，不是「这句不要了」——上一版撤完文字直接消失，
 * 打好的一段话就这么没了。而人撤回往往正是为了改两个字再发。
 * 所以按钮上写「取回」不写「撤回」：它描述的是真实发生的事。
 *
 * ## 为什么还要「立刻插入」
 *
 * 排着的那句**往往正是「别再往下走了」**——等这一轮跑完再说等于白说。
 * codex 自己的界面就是这么做的（排队条上一颗「调整方向」），omni 跟它对齐：
 * 默认排队，插入是一个明确的动作。引擎不支持当场插话时这颗不出现——
 * 一个点了没反应的按钮比没有它更糟。
 */
export function Queued({ texts, onDrop, onInsert }: {
  texts: readonly string[]
  onDrop: () => void
  /** 引擎支持当场插话时才给。 */
  onInsert?: () => void
}): React.JSX.Element | null {
  if (texts.length === 0) return null
  return (
    <div className="queued">
      <span className="queued__badge">排队中 {texts.length}</span>
      <span className="queued__text" title={texts.join("\n")}>
        {texts[0]}
      </span>
      {onInsert === undefined ? null : (
        <button type="button" className="act queued__act" title="不等这一轮跑完，现在就递进去" onClick={onInsert}>
          立刻插入
        </button>
      )}
      <button
        type="button"
        className="act queued__drop"
        title="把这几句取回输入框，先不发。正在跑的那一轮不受影响"
        onClick={onDrop}
      >
        取回
      </button>
    </div>
  )
}
