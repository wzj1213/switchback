import { useId, useState } from "react"
import type {
  Command,
  PendingQuestion,
  QuestionResponse,
} from "@switchback/protocol"
import {
  draftOf,
  freshDrafts,
  questionResponse,
  type QuestionDraft,
  type QuestionDrafts,
} from "../question-answer.js"
import { QuestionField } from "./QuestionField.js"
import { useMessages } from "../i18n.js"
import { QUESTION_CARD } from "./QuestionCard.messages.js"

function Card({ group, onResolve, offline }: {
  group: PendingQuestion
  onResolve: (response: QuestionResponse) => void
  offline: boolean
}): React.JSX.Element {
  const prefix = useId()
  const m = useMessages(QUESTION_CARD)
  const [drafts, setDrafts] = useState<QuestionDrafts>(() => freshDrafts(group.questions))
  const response = questionResponse(group.questions, drafts)
  const update = (id: string, draft: QuestionDraft): void => {
    setDrafts((current) => ({ ...current, [id]: draft }))
  }
  return (
    <form
      className="question-card"
      aria-label={m.label}
      onSubmit={(event) => {
        event.preventDefault()
        if (!offline && response !== undefined) onResolve(response)
      }}
    >
      <div className="question-card__head">
        <span>{m.label}</span>
        <span>{m.count(group.questions.length, group.expiresAt !== undefined)}</span>
      </div>
      <div className="question-card__body">
        {group.questions.map((question, index) => (
          <QuestionField
            key={question.id}
            question={question}
            index={index}
            prefix={prefix}
            draft={draftOf(drafts, question.id)}
            update={(draft) => update(question.id, draft)}
            disabled={offline}
          />
        ))}
      </div>
      <div className="question-card__actions">
        <button
          className="btn"
          type="button"
          disabled={offline}
          onClick={() => onResolve({ dismissed: true })}
        >
          {m.skip}
        </button>
        <button className="btn btn--primary" type="submit" disabled={offline || response === undefined}>
          {m.answer}
        </button>
      </div>
      {offline ? <p className="question-card__offline">{m.offline}</p> : null}
    </form>
  )
}

export function QuestionStack({ threadId, groups, send, offline }: {
  threadId: string
  groups?: readonly PendingQuestion[]
  send: (command: Command) => boolean
  offline: boolean
}): React.JSX.Element | null {
  const m = useMessages(QUESTION_CARD)
  const pending = groups ?? []
  if (pending.length === 0) return null
  return (
    <div className="question-stack" role="region" aria-label={m.stack}>
      {pending.map((group) => (
        <Card
          key={group.id}
          group={group}
          offline={offline}
          onResolve={(response) => send({
            type: "question.resolve",
            threadId,
            questionId: group.id,
            response,
          })}
        />
      ))}
    </div>
  )
}
