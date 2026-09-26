import type { DraftBlock } from "../composer-blocks.js"
import { fileChip, pasteChip } from "../composer-blocks.js"
import { CloseIcon, LinesIcon } from "./icons-panel.js"
import { FileIcon } from "./icons-activity.js"

/**
 * 输入框上方那排待发芯片：拖进来的文件、折起来的大段粘贴。
 *
 * 和图片那排（`Attachments`）并排、同一种语言：**你附上的东西都在正文上方**，
 * 正文里只有你自己打的字。为什么不再把路径写进正文，见 `composer-blocks.ts`。
 *
 * 每一枚都能移除，而且**完整内容随时看得到**——文件是整条路径，
 * 粘贴是开头那几百字。芯片可以省略显示，但不能让人查不到自己要发的是什么。
 */
function peekOf(text: string): string {
  const head = text.slice(0, 400)
  return head.length < text.length ? `${head}…` : head
}

function Chip({
  block,
  onRemove,
}: {
  block: DraftBlock
  onRemove: () => void
}): React.JSX.Element {
  const file = block.kind === "file" ? fileChip(block.path) : undefined
  const title = block.kind === "file" ? block.path : peekOf(block.text)
  const label = block.kind === "file" ? "" : (block.label ?? pasteChip(block.text))
  return (
    <span className="dblock" title={title}>
      <span className="dblock__glyph" aria-hidden="true">
        {file === undefined ? <LinesIcon size={13} /> : <FileIcon size={13} />}
      </span>
      {file === undefined ? (
        <span className="dblock__name">{label}</span>
      ) : (
        <>
          {file.parent === "" ? null : <span className="dblock__dir">{file.parent}</span>}
          <span className="dblock__name">{file.name}</span>
        </>
      )}
      <button
        type="button"
        className="dblock__x"
        aria-label={`移除 ${file === undefined ? "这段粘贴文本" : file.name}`}
        onClick={onRemove}
      >
        <CloseIcon size={11} />
      </button>
    </span>
  )
}

export function DraftBlocks({
  blocks,
  onRemove,
}: {
  blocks: readonly DraftBlock[]
  onRemove: (id: string) => void
}): React.JSX.Element | null {
  if (blocks.length === 0) return null
  return (
    <div className="dblocks">
      {blocks.map((block) => (
        <Chip
          key={block.id}
          block={block}
          onRemove={() => {
            onRemove(block.id)
          }}
        />
      ))}
    </div>
  )
}
