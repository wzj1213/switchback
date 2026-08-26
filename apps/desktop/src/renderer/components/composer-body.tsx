import type { stateOf } from "./composer-state.js"
import type { ComposerProps } from "./Composer.js"
import type { useComposerDraft } from "../use-composer-draft.js"
import type { useComposerFiles } from "../use-composer-files.js"
import type { useComposerFocus } from "../use-composer-focus.js"
import type { useComposerMemory } from "../use-composer-memory.js"
import { Attachments } from "./Attachments.js"
import { AttachmentDrop } from "./AttachmentDrop.js"
import { Chips } from "./Chips.js"
import { ComposerControls } from "./composer-controls.js"
import { ComposerRing } from "./composer-ring.js"
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

export function ComposerBody(view: Props): React.JSX.Element {
  const { composer, detached, busy, starting, focus, attach, aside } = view
  const { attachWarning, attachmentBlocked, mode, draft, files } = view
  return (
    <div className="composer">
      <div className="composer__inner">
        <ComposerRing />
        <AttachmentDrop hint={files.dropzone.hint} />
        {detached ? null : (
          <Chips
            threadId={composer.threadId}
            cwd={composer.cwd}
            project={projectOf(composer.cwd)}
            stamp={composer.stamp}
            passing={composer.passing}
          />
        )}
        <Attachments paths={attach.paths} onRemove={attach.remove} />
        <AttachmentWarning
          notice={
            attachWarning === undefined ? attach.notice : { text: attachWarning, tone: "warn" }
          }
        />
        <Prompt
          input={focus.input}
          value={draft.text}
          detached={detached}
          starting={starting}
          queueing={mode.queueing}
          steering={mode.steering}
          cwd={composer.cwd}
          onPaste={files.paste}
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
        <ComposerControls
          detached={detached}
          busy={busy}
          starting={starting}
          attachmentBlocked={attachmentBlocked}
          text={draft.text}
          hasCommand={draft.command !== undefined}
          attachments={attach.paths.length}
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
