import { useEffect, useRef, useState } from "react"
import { useModalKeys } from "../useModalKeys.js"

/**
 * 改名对话框。
 *
 * ## 为什么从「就地编辑」换成了它
 *
 * 上一版是在侧栏那一行里就地改，理由写在这儿：「你多半是在一串相似标题之间
 * 分辨哪个是哪个，而对话框会把那一串盖住」。**实际用下来这条不成立**：
 * 那一行只有 264px 宽，输入框里放不下一个完整标题，改的时候看到的是被截断的
 * 半句话；而真正要参照的上下文是**这条会话本身**（正文、它改过哪些文件），
 * 那些在右边，对话框根本不挡。
 *
 * 换成对话框还顺带解决两件事：改名时看得见完整的当前名字（可以在它上面改，
 * 而不是重打一遍）；以及有一个明确的「取消」——就地编辑那版只能靠 Esc，
 * 而那是个只有知道的人才知道的出口。
 *
 * ## 三条规矩沿用上一版
 *
 * - **回车提交、Esc 取消。** 这一版的失焦**不再提交**：对话框里失焦通常是
 *   去点「取消」或「保存」，替他猜是哪一个不如让他自己点。
 * - **空名字不提交**：按取消处理，侧栏那一行会变成一块什么都不写的空白。
 * - **名字没变就不发命令**：省掉一条写进日志的空事件。
 */
export function RenameDialog({ title, onSave, onClose }: {
  /** 当前名字。**整句都要给**——在它上面改比重打一遍省事，这也是换成对话框的理由之一。 */
  title: string
  onSave: (title: string) => void
  onClose: () => void
}): React.JSX.Element {
  const box = useModalKeys(onClose)
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(title)
  // 打开就选中整句：多数改名是「换一个说法」，少数是「补两个字」——
  // 选中让前者一按就替掉，而后者按一下右方向键就回到光标在末尾
  useEffect(() => {
    input.current?.select()
  }, [])
  const clean = draft.trim()
  const commit = (): void => {
    if (clean !== "" && clean !== title) onSave(clean)
    onClose()
  }
  return (
    <div
      className="rename__scrim"
      onPointerDown={(e) => {
        // 只有点到遮罩本身才关：点面板内部冒泡上来的不算，
        // 否则在输入框里拖选一段文字、松手落在遮罩上也会把它关掉
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="rename"
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-title"
      >
        <h2 className="rename__title" id="rename-title">重命名聊天</h2>
        <p className="rename__hint">保持简短且易于识别</p>
        {/* 表单套在里面：`useModalKeys` 给的是 div 的 ref，而回车提交要的是 form */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            commit()
          }}
        >
          <input
            ref={input}
            className="rename__input"
            value={draft}
            maxLength={200}
            aria-label="会话名字"
            onChange={(e) => {
              setDraft(e.target.value)
            }}
          />
          <div className="rename__acts">
            <button type="button" className="rename__cancel" onClick={onClose}>取消</button>
            {/* 空名字不给保存：保存了侧栏那一行会变成一块什么都不写的空白 */}
            <button type="submit" className="rename__save" disabled={clean === ""}>保存</button>
          </div>
        </form>
      </div>
    </div>
  )
}
