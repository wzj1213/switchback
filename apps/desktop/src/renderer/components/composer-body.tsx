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
import { projectOf } from "./composer-state.js"
import { takeCommand } from "./ComposerAction.js"
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
 * 「这句话会发到哪儿去」那几枚。
 *
 * **起手时自己一行，开工之后缩进控件那一排**——两处只是位置不同，
 * 取数与措辞是同一份（见 `Chips`）。历史记录没有「发出去」这回事，两处都不给。
 */
function siteChips(view: Props, opening: boolean): React.JSX.Element | null {
  const { composer } = view
  if (view.detached) return null
  return (
    <Chips
      threadId={composer.threadId}
      cwd={composer.cwd}
      project={projectOf(composer.cwd)}
      stamp={composer.stamp}
      passing={composer.passing}
      compact={!opening}
    />
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
  const opening = composer.opening === true
  const site = siteChips(view, opening)
  return (
    <div className="composer">
      <div
        className={`composer__inner${opening ? " composer__inner--opening" : ""}`}
        onMouseDown={(event) => { focusFromBlank(event, focus.input) }}
      >
        <AttachmentDrop hint={files.dropzone.hint} surface={composer.dropSurfaceVisible} />
        {opening ? site : null}
        <Attachments paths={attach.paths} onRemove={attach.remove} />
        {/* 拖进来的文件、折起来的大段粘贴。**和图片那排并排**：
            你附上的东西都在正文上方，正文里只有你自己打的字 */}
        <DraftBlocks blocks={blocks.blocks} onRemove={blocks.remove} />
        <AttachmentWarning notice={notice} />
        <Prompt
          input={focus.input}
          value={draft.text}
          detached={detached}
          starting={starting}
          queueing={mode.queueing}
          steering={mode.steering}
          cwd={composer.cwd}
          onPaste={files.paste}
          onPasteText={blocks.addPaste}
          commands={aside.commands(composer.commands)}
          command={draft.command}
          onClearCommand={() => draft.setCommand(undefined)}
          onCommand={(command) => {
            if (aside.take(command, () => draft.setText(""))) return
            takeCommand(command, draft.setText, draft.setCommand, composer.onOmni)
          }}
          searchFiles={composer.searchFiles}
          onChange={draft.setText}
          onSubmit={draft.submit}
          onAside={() =>
            aside.ask(draft.text, draft.command !== undefined, attachmentBlocked, () => {
              draft.setText("")
            })
          }
          asideMode={aside.on}
          onAsideExit={aside.exit}
        />
        {/* 按会话重建这一排：选完模型等回声的那份本地值、开着的菜单，都不能带到别的会话上 */}
        <ComposerControls
          key={composer.threadId}
          detached={detached}
          busy={busy}
          starting={starting}
          site={opening ? undefined : site}
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
          onResume={composer.onResume}
          onInterrupt={composer.onInterrupt}
          onSend={draft.submit}
        />
      </div>
    </div>
  )
}
