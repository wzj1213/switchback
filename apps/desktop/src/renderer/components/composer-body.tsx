import type { stateOf } from "./composer-state.js"
import type { ComposerProps } from "./Composer.js"
import type { useComposerDraft } from "../use-composer-draft.js"
import type { useComposerFiles } from "../use-composer-files.js"
import type { useComposerFocus } from "../use-composer-focus.js"
import type { useComposerMemory } from "../use-composer-memory.js"
import { Attachments } from "./Attachments.js"
import { DraftBlocks } from "./DraftBlocks.js"
import { AttachmentDrop } from "./AttachmentDrop.js"
import { Chips } from "./Chips.js"
import { ComposerControls } from "./composer-controls.js"
import { takeCommand } from "./ComposerAction.js"
import { composeDraft } from "../composer-blocks.js"
import { Prompt } from "./Prompt.js"

interface Props {
  composer: ComposerProps
  detached: boolean
  busy: boolean
  starting: boolean
  focus: ReturnType<typeof useComposerFocus>
  attach: ReturnType<typeof useComposerMemory>["attach"]
  blocks: ReturnType<typeof useComposerMemory>["blocks"]
  aside: ReturnType<typeof useComposerMemory>["aside"]
  attachWarning: string | undefined
  attachmentBlocked: boolean
  mode: ReturnType<typeof stateOf>
  draft: ReturnType<typeof useComposerDraft>
  files: ReturnType<typeof useComposerFiles>
}

function AttachmentWarning({
  notice,
}: {
  notice: { text: string; tone: "info" | "warn" } | undefined
}): React.JSX.Element | null {
  return notice === undefined ? null : (
    <p className={`composer__attachwarn composer__attachwarn--${notice.tone}`} role="status">
      {notice.text}
    </p>
  )
}

/**
 * 「这句话会发到哪儿去」那几枚，缩在控件那一排里（见 `Chips`）。
 * 历史会话也给：发话就会接回来，分支和脏标正是发之前该看一眼的。
 */
function siteChips(view: Props): React.JSX.Element {
  const { composer } = view
  return (
    <Chips threadId={composer.threadId} cwd={composer.cwd} stamp={composer.stamp} passing={composer.passing} />
  )
}

/**
 * 点输入卡的空白处也进输入框。
 *
 * 卡片有一百多像素高，真正点得进去的只有那两行字——点在芯片行和控件行之间的留白上
 * 什么都不发生，看起来就像输入框坏了。按钮、链接、芯片、缩略图这些自己能点的东西不接管。
 * 在按下时就给焦点并拦下默认行为：不拦的话按下会先把焦点落到卡片上，松手才被抢回来，闪一下。
 */
function focusFromBlank(event: React.MouseEvent, input: React.RefObject<HTMLTextAreaElement | null>): void {
  if (event.button !== 0) return
  const target = event.target as HTMLElement
  if (target.closest("button, a, input, textarea, select, label, [role], [contenteditable]") !== null) return
  const field = input.current
  if (field === null || field.disabled) return
  event.preventDefault()
  field.focus()
}

export function ComposerBody(view: Props): React.JSX.Element {
  const { composer, detached, busy, starting, focus, attach, aside, blocks } = view
  const { attachWarning, attachmentBlocked, mode, draft, files } = view
  const notice = attachWarning === undefined
    ? (files.dropzone.hint?.compact === true ? undefined : attach.notice)
    : { text: attachWarning, tone: "warn" as const }
  const site = siteChips(view)
  return (
    <div className="composer">
      <div className="composer__inner" onMouseDown={(event) => { focusFromBlank(event, focus.input) }}>
        <AttachmentDrop hint={files.dropzone.hint} surface={composer.dropSurfaceVisible} />
        {composer.tray}
        <Attachments paths={attach.paths} onRemove={attach.remove} />
        {/* 拖进来的文件、折起来的大段粘贴。**和图片那排并排**：
            你附上的东西都在正文上方，正文里只有你自己打的字 */}
        <DraftBlocks blocks={blocks.blocks} onRemove={blocks.remove} />
        <AttachmentWarning notice={notice} />
        <Prompt
          input={focus.input}
          value={draft.text}
          history={composer.history?.text}
          starting={starting}
          queueing={mode.queueing}
          steering={mode.steering}
          cwd={composer.cwd}
          onPaste={files.paste}
          onPasteText={blocks.addPaste}
          commands={aside.commands(composer.commands)}
          command={draft.command}
          onClearCommand={() => draft.setCommand(undefined)}
          onCommand={(command, rest) => {
            if (aside.take(command, () => draft.setText(rest))) return
            takeCommand(command, rest, { setText: draft.setText, setCommand: draft.setCommand, onSwitchback: composer.onSwitchback })
          }}
          searchFiles={composer.searchFiles}
          onChange={draft.setText}
          onSubmit={draft.submit}
          onAside={() =>
            // 和侧问模式里回车走同一份草稿：芯片里的引用与粘贴一起展开进去，
            // 不然「这里为什么这样？」发出去了，「这里」指的那段却还留在输入框里
            aside.ask(composeDraft(draft.text, blocks.blocks), draft.command !== undefined, attachmentBlocked, () => {
              draft.setText("")
              blocks.clear()
            })
          }
          asideMode={aside.on}
          onAsideExit={aside.exit}
        />
        {/* 按会话重建这一排：选完模型等回声的那份本地值、开着的菜单，都不能带到别的会话上 */}
        <ComposerControls
          key={composer.threadId}
          detached={detached}
          held={composer.history?.held === true}
          busy={busy}
          starting={starting}
          site={site}
          attachmentBlocked={attachmentBlocked}
          text={draft.text}
          hasCommand={draft.command !== undefined}
          attachments={attach.paths.length}
          blocks={blocks.blocks.length}
          engine={composer.engine}
          engines={composer.engines}
          trust={composer.trust}
          models={composer.models}
          model={composer.model}
          effort={composer.effort}
          usage={composer.usage}
          pending={composer.pending}
          onEngineChange={composer.onEngineChange}
          onTrustChange={composer.onTrustChange}
          hint={composer.hint}
          blind={composer.blind}
          aside={aside.on}
          onAsideExit={aside.exit}
          onModelChange={composer.onModelChange}
          onAttach={() => {
            void files.pick()
          }}
          onInterrupt={composer.onInterrupt}
          onSend={draft.submit}
        />
      </div>
    </div>
  )
}
