import { useEffect, useState } from "react"

/**
 * 改名的控制面。做成一个对象往下传，而不是四个回调——
 * 它要穿过 `SectionList`、`GroupBlock` 两层才到得了行上，
 * 四个参数一路带下去，每加一层就多四个 props。
 */
export interface RenameCtl {
  /** 正在改的那一行。`undefined` = 没有人在改。 */
  id: string | undefined
  start: (id: string) => void
  commit: (id: string, title: string) => void
  done: () => void
}

/**
 * 谁在改名。
 *
 * **状态放在侧栏这一层，不是放在行里**：同时只能有一行在改。
 * 放在行里的话，两行同时进编辑态是可能的（右键一行、又去双击另一行），
 * 那时候回车提交的是哪一个，说不清楚。
 */
export function useRenaming(
  onRename: (id: string, title: string) => void,
  /** 外面请求「给这一行改名」的计数器（`/rename` 命令走这条路）。变一次就进编辑态。 */
  request?: { at: number; id: string },
): RenameCtl {
  const [id, setId] = useState<string | undefined>(undefined)
  const at = request?.at ?? 0
  const target = request?.id
  // **只跟着计数器走。** 计数器进 deps、目标 id 不进——不然选中会话一变
  // 就会重新进一次编辑态，而用户只是切了个会话
  useEffect(() => {
    if (at > 0 && target !== undefined) setId(target)
  }, [at])
  return {
    id,
    start: setId,
    commit: (target, title) => {
      setId(undefined)
      onRename(target, title)
    },
    done: () => {
      setId(undefined)
    },
  }
}

/**
 * 侧栏那一行显示的名字。
 *
 * ## 改名为什么从这儿搬走了
 *
 * 这里一度是**就地编辑**：双击进输入框、回车提交。当时写的理由是「对话框会
 * 盖住那一串相似标题，而你正要靠它们分辨哪个是哪个」。实际用下来那条不成立——
 * 这一行只有 264px 宽，输入框里放不下一个完整标题，改的时候看到的是被截断的
 * 半句话；而真正要参照的上下文是**这条会话本身**（正文、它改过哪些文件），
 * 那些在右边，对话框根本不挡。现在走 `RenameDialog`。
 *
 * 顺带记下就地那版踩过、而对话框天然没有的两个坑：一是输入框的种子不能依赖
 * `rowLabelOf(row)`——它跟着 preview 变，正在跑的会话每吐一段就把你打了一半的
 * 名字整个替换掉；二是失焦该提交还是该撤销，两种都有人觉得反直觉。
 */
export function RowName({ value }: { value: string }): React.JSX.Element {
  return <span className="row__label">{value}</span>
}
