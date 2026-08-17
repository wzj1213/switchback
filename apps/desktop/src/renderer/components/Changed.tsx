import { useEffect, useState } from "react"
import type { Item } from "@omni/protocol"
import { changesOf, type ChangedFile } from "../tool.js"
import { FileDiff } from "./Diff.js"
import { splitPath } from "../diff.js"
import { RevealIcon, CopyIcon } from "./icons.js"

/**
 * 「N 个文件已更改 +A −B」，挂在输入框上方。**点得开。**
 *
 * ## 它回答的是「我可以走了吗」
 *
 * agent 跑了十分钟，你要提交之前想知道它总共动了多少。这件事在 transcript 里是散的
 * （分布在十几条编辑行上），没人加起来的话只能自己往回翻着数。
 *
 * ## 为什么上一版那枚胶囊不够
 *
 * 它只有一个总数，而且**点不动**——`changesOf` 把逐个文件的账算出来之后当场扔掉。
 * 于是「4 个文件」这句话之后，你还是得自己往回翻去找是哪四个。
 * 现在点开就是那四行：路径、各自的增删、点一行看它最后被改成什么样。
 *
 * ## 排序按「首次出现」，不按字母
 *
 * 你回头找的是「它刚才动的那个」，那多半在后面（见 `changesOf`）。
 *
 * ## 一个必须说出来的边界
 *
 * 这里的账**只认编辑类工具报上来的改动**。引擎用 shell 直接写文件
 *（`sed -i`、`>` 重定向、跑一个生成脚本）一个都不算——那类改动 omni 看不见，
 * 它只看见「跑了一条命令」。所以这枚胶囊说的是「**它报告它改了这些**」，
 * 不是「工作区里变了这些」。后者要问 git，那是另一件事。
 */
const FOLD_AT = 5

export function Changed({ items, cwd, stamp, onReveal, onCopy }: {
  items: readonly Item[]
  /** 工作区。展开时要问它一次 git。 */
  cwd: string
  /** 轮次戳：变一次就重问一遍 git——引擎跑完一轮，工作区就不一样了。 */
  stamp: string
  /** 在访达里定位。 */
  onReveal: (path: string) => void
  onCopy: (text: string) => void
}): React.JSX.Element | null {
  const { files, added, removed, list } = changesOf(items)
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  // **不等展开才问 git**：引擎跑完 `pnpm build` 改了三十个文件却一条编辑都没报时，
  // 胶囊本身会是隐藏的——那时最该出声的恰恰是这一节。一轮问一次，和芯片同一个节奏
  const others = useOthers(cwd, stamp, list)
  if (files === 0 && others.length === 0) return null
  const shown = all ? list : list.slice(0, FOLD_AT)
  return (
    <div className="changed">
      {open ? (
        <div className="changed__list">
          {shown.map((file) => (
            <Row key={file.path} file={file} onReveal={onReveal} onCopy={onCopy} />
          ))}
          {others.length === 0 ? null : <Others paths={others} onReveal={onReveal} />}
          {list.length <= FOLD_AT ? null : (
            <button
              type="button"
              className="changed__more"
              onClick={() => {
                setAll((was) => !was)
              }}
            >
              {all ? "收起" : `再显示 ${String(list.length - FOLD_AT)} 个`}
            </button>
          )}
        </div>
      ) : null}
      <button
        type="button"
        className={`changed__pill${open ? " changed__pill--open" : ""}`}
        aria-expanded={open}
        title={open ? "收起" : "看看是哪些文件"}
        onClick={() => {
          setOpen((was) => !was)
        }}
      >
        {label(files, others.length)}
        <Stat added={added} removed={removed} />
      </button>
    </div>
  )
}

/**
 * 胶囊上那句话。**编辑工具报的优先**：它是可追溯的那一份；
 * 一条都没报、而工作区确实变了时才退到后者（多半是引擎用命令改的）。
 */
function label(files: number, others: number): string {
  return files > 0 ? `${String(files)} 个文件已更改` : `${String(others)} 个文件变了`
}

/** 增删两个数。零的那个不画——「+0」不是信息。 */
function Stat({ added, removed }: { added: number; removed: number }): React.JSX.Element {
  return (
    <>
      {added > 0 ? <span className="diffstat__add">+{added}</span> : null}
      {removed > 0 ? <span className="diffstat__del">−{removed}</span> : null}
    </>
  )
}

/**
 * 一个文件一行。点行展开它**最后一次**被改成什么样。
 *
 * 行尾两颗按钮：在访达里定位、复制这一份 diff。**不做「打开文件」**——
 * 那要决定用哪个编辑器打开，而 `showItemInFolder` 只是定位，
 * 最坏的后果就是访达里跳出一个窗口（见 preload 里那段安全论证）。
 */
function Row({ file, onReveal, onCopy }: {
  file: ChangedFile
  onReveal: (path: string) => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { dir, name } = splitPath(file.path)
  return (
    <div className="changed__file">
      <div className="changed__row">
        <button
          type="button"
          className="changed__name"
          title={file.path}
          aria-expanded={open}
          onClick={() => {
            setOpen((was) => !was)
          }}
        >
          <span className="changed__dir">{dir}</span>
          <span className="changed__base">{name}</span>
        </button>
        <span className="changed__stat">
          <Stat added={file.added} removed={file.removed} />
        </span>
        <button
          type="button"
          className="changed__act"
          aria-label="在访达中显示"
          title="在访达中显示"
          onClick={() => {
            onReveal(file.path)
          }}
        >
          <RevealIcon size={12} />
        </button>
        <button
          type="button"
          className="changed__act"
          aria-label="复制这份改动"
          title="复制这份改动"
          onClick={() => {
            onCopy(`${file.path}\n\n${file.last.diff ?? "（这次编辑没有带补丁）"}`)
          }}
        >
          <CopyIcon size={12} />
        </button>
      </div>
      {open ? <FileDiff file={file.last} /> : null}
    </div>
  )
}

/**
 * 工作区里**变了、但不是编辑工具报上来的**那些文件。
 *
 * 引擎用 shell 改文件（`sed -i`、`>` 重定向、跑一个生成脚本）omni 一个都看不见，
 * 它只看见「跑了一条命令」。跑完 `pnpm build` 改了三十个文件，卡上写着 0——
 * 问一次 git 就能把这块盲区摊开。
 *
 * **不合进主数字**：那份可以追溯到具体某一条工具行，这一份不能——它分不出
 * 是引擎跑的命令改的，还是你自己在编辑器里改的。所以文案也照实说这句话。
 * 要分得出，得在会话开始时留一份基线快照，那是另一件事（见 README 的已知限制）。
 */
function useOthers(cwd: string, stamp: string, known: readonly ChangedFile[]): readonly string[] {
  const [paths, setPaths] = useState<readonly string[]>([])
  const mine = known.map((f) => f.path).join("\n")
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.omni
    if (cwd === "" || bridge === undefined) {
      setPaths([])
      return undefined
    }
    let live = true
    void bridge.workChanges(cwd).then((out) => {
      if (!live) return
      // 引擎报的路径可能是 `/tmp/...` 而 git 给的是 `/private/tmp/...`：
      // 只比末尾一段对不上的风险太大，所以两边都用「谁是谁的后缀」判同一个文件
      const same = (a: string, b: string): boolean => a === b || a.endsWith(b) || b.endsWith(a)
      const ours = mine === "" ? [] : mine.split("\n")
      setPaths((out?.paths ?? []).filter((p) => !ours.some((o) => same(o, p))))
    })
    return () => {
      live = false
    }
  }, [cwd, stamp, mine])
  return paths
}

/** 盲区那一节。**标题就是它的置信度**，别写成「它还改了这些」。 */
function Others({ paths, onReveal }: { paths: readonly string[]; onReveal: (path: string) => void }): React.JSX.Element {
  return (
    <div className="changed__others">
      <p className="changed__note">
        另有 {paths.length} 个文件与 git 不同，<strong>不是</strong>通过编辑工具改的——
        可能是它跑的命令，也可能是你自己改的
      </p>
      {paths.slice(0, FOLD_AT).map((path) => (
        <div className="changed__row" key={path}>
          <span className="changed__name changed__name--flat" title={path}>
            <span className="changed__dir">{splitPath(path).dir}</span>
            <span className="changed__base">{splitPath(path).name}</span>
          </span>
          <button
            type="button"
            className="changed__act"
            aria-label="在访达中显示"
            title="在访达中显示"
            onClick={() => {
              onReveal(path)
            }}
          >
            <RevealIcon size={12} />
          </button>
        </div>
      ))}
      {paths.length <= FOLD_AT ? null : <p className="changed__note">…还有 {paths.length - FOLD_AT} 个</p>}
    </div>
  )
}
