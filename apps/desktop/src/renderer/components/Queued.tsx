/**
 * 排着队还没发出去的那几句。
 *
 * ## 撤回是排队这件事成立的前提
 *
 * 排队的那句是**还没发生的事**，而人改主意的窗口恰恰在这段时间里。
 * 撤回不是额外功能，是排队这件事成立的前提。
 *
 * ## 一条一行，各自能取回
 *
 * 上一版不管排了几句都只画一行：显示第一句，其余进 `title`，配一颗取回——
 * 而那颗取回**整队一起端走**，还把几句用换行拼成一段草稿，拼完就分不开了。
 * 排到第二句之后，「把刚才那句拿回来」实际上做不到。
 *
 * 现在每条各有各的取回（`onDrop(index)`）；排了两句以上才多出一行总操作。
 * **只排一句时和上一版长得一模一样**——那是绝大多数时候的样子。
 *
 * ## 插入为什么仍然是整队一起
 *
 * `thread.steerQueued` 有意把几句合成一段递进去（见 `host/prompt.ts`）：
 * 分几次插的话，中间那几句可能落在不同的工具调用之间。所以它是**总操作**，
 * 排了两句以上时就挪到收尾那行去，免得挂在某一条上像是只插这一条。
 *
 * codex 自己的界面就是这么做的（排队条上一颗「调整方向」），omni 跟它对齐：
 * 默认排队，插入是一个明确的动作。引擎不支持当场插话时这颗不出现——
 * 不是灰着，是不画。
 */
function queuedLine(text: string | undefined, attachments: number): string {
  const parts = [text ?? ""]
  if (attachments > 0) parts.push(`${String(attachments)} 张图片`)
  return parts.filter((part) => part !== "").join(" · ") || "待发送内容"
}

const DROP_TITLE = "把这句话和它的附件取回输入框，先不发。正在跑的那一轮不受影响"
const INSERT_TITLE = "不等这一轮跑完，现在就递进去"

function InsertButton({ label, onInsert }: { label: string; onInsert: () => void }): React.JSX.Element {
  return (
    <button type="button" className="act queued__act" title={INSERT_TITLE} onClick={onInsert}>
      {label}
    </button>
  )
}

export function Queued({ texts, attachments, active, onDrop, onInsert }: {
  texts: readonly string[]
  /** 与 texts 按下标对齐；旧记录没有时为空数组。 */
  attachments: readonly (readonly string[])[]
  /** 仍有一轮在跑；缺席表示断开/失败后留下的待发内容。 */
  active: boolean
  /** 取回第 index 条；不给下标就是整队一起取回。 */
  onDrop: (index?: number) => void
  /** 引擎支持当场插话时才给。**整队一起插**，见文件头。 */
  onInsert?: () => void
}): React.JSX.Element | null {
  if (texts.length === 0) return null
  const total = texts.length
  const many = total > 1
  const word = active ? "排队中" : "待发送"
  const canInsert = active && onInsert !== undefined
  return (
    <div className="queued">
      {texts.map((text, index) => (
        // 下标当 key 在这里是对的：这是一个**位置**队列，条目没有别的身份，
        // 而取回也正是按位置发的（`onDrop(index)`）
        <div className="queued__row" key={index}>
          <span className="queued__badge">
            {word} {many ? `${String(index + 1)}/${String(total)}` : String(total)}
          </span>
          <span className="queued__text" title={queuedLine(text, attachments[index]?.length ?? 0)}>
            {queuedLine(text, attachments[index]?.length ?? 0)}
          </span>
          {/* 只排一句时插入就挂在这一条上——那时「整队」和「这一条」是同一件事 */}
          {!many && canInsert && onInsert !== undefined ? (
            <InsertButton label="立刻插入" onInsert={onInsert} />
          ) : null}
          <button
            type="button"
            className="act queued__drop"
            title={DROP_TITLE}
            onClick={() => {
              onDrop(index)
            }}
          >
            取回
          </button>
        </div>
      ))}
      {many ? (
        <div className="queued__row queued__row--foot">
          {canInsert && onInsert !== undefined ? (
            <InsertButton label="全部插入" onInsert={onInsert} />
          ) : null}
          <button
            type="button"
            className="act queued__drop"
            title="把排着的这几句全部取回输入框，按顺序拼成一段"
            onClick={() => {
              onDrop()
            }}
          >
            全部取回
          </button>
        </div>
      ) : null}
    </div>
  )
}
