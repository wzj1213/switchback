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

function Card({ group, onResolve }: {
  group: PendingQuestion
  onResolve: (response: QuestionResponse) => void
}): React.JSX.Element {
  const prefix = useId()
  const [drafts, setDrafts] = useState<QuestionDrafts>(() => freshDrafts(group.questions))
  const response = questionResponse(group.questions, drafts)
  const update = (id: string, draft: QuestionDraft): void => {
    setDrafts((current) => ({ ...current, [id]: draft }))
  }
  return (
    <form
      className="question-card"
      aria-label="需要你回答"
      onSubmit={(event) => {
        event.preventDefault()
        if (response !== undefined) onResolve(response)
      }}
    >
      <div className="question-card__head">
        <span>需要你回答</span>
        <span>{String(group.questions.length)} 题{group.expiresAt === undefined ? "" : " · 将自动跳过"}</span>
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
          />
        ))}
      </div>
      <div className="question-card__actions">
        <button className="btn" type="button" onClick={() => onResolve({ dismissed: true })}>
          跳过这组
        </button>
        <button className="btn btn--primary" type="submit" disabled={response === undefined}>回答</button>
      </div>
    </form>
  )
}

export function QuestionStack({ threadId, groups, send }: {
  threadId: string
  groups: readonly PendingQuestion[]
  send: (command: Command) => void
}): React.JSX.Element | null {
  if (groups.length === 0) return null
  return (
    <div className="question-stack" aria-label="待回答的问题">
      {groups.map((group) => (
        <Card
          key={group.id}
          group={group}
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
