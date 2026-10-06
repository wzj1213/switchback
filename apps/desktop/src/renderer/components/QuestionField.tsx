import type { QuestionPrompt } from "@switchback/protocol"
import type { QuestionDraft } from "../question-answer.js"

const MAX_EXTERNAL_URL = 4096

interface Props {
  question: QuestionPrompt
  index: number
  prefix: string
  draft: QuestionDraft
  update: (draft: QuestionDraft) => void
}

function safeExternalUrl(raw: string): { url: string; host: string } | undefined {
  if (raw.length === 0 || raw.length > MAX_EXTERNAL_URL) return undefined
  try {
    const url = new URL(raw)
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") {
      return undefined
    }
    return { url: url.toString(), host: url.host }
  } catch {
    return undefined
  }
}

function optionIds(draft: QuestionDraft, id: string, checked: boolean): readonly string[] {
  return checked ? [...draft.optionIds, id] : draft.optionIds.filter((seen) => seen !== id)
}

function answerType(question: QuestionPrompt): "password" | "text" {
  return question.secret === true ? "password" : "text"
}

function OtherAnswer({ question, index, prefix, draft, update }: Props): React.JSX.Element | null {
  if (question.allowOther !== true) return null
  const multi = question.multiSelect === true
  const id = `${prefix}-other-${String(index)}`
  return (
    <div className="question-other">
      <label className="question-option" htmlFor={id}>
        <input
          className="question-option__control"
          id={id}
          type={multi ? "checkbox" : "radio"}
          name={`${prefix}-choice-${String(index)}`}
          checked={draft.other}
          onChange={(event) => {
            update({ ...draft, other: event.target.checked, ...(multi ? {} : { optionIds: [] }) })
          }}
        />
        <span className="question-option__copy">{question.otherLabel ?? "其他"}</span>
      </label>
      {draft.other ? (
        <input
          className="question-other__input"
          type={answerType(question)}
          autoComplete="off"
          spellCheck={question.secret !== true}
          value={draft.otherText}
          aria-label={question.otherLabel ?? "其他答案"}
          placeholder={question.otherDescription ?? "写下你的答案"}
          onChange={(event) => {
            update({ ...draft, other: true, otherText: event.target.value })
          }}
        />
      ) : null}
    </div>
  )
}

function NoteAnswer({ question, index, prefix, draft, update }: Props): React.JSX.Element | null {
  if (question.allowNote !== true || draft.other) return null
  const id = `${prefix}-note-${String(index)}`
  const ready = question.options.length === 0 || draft.optionIds.length > 0
  const fallback = question.options.length === 0 ? "输入回答" : "可选：补充上下文"
  return (
    <label className="question-note" htmlFor={id}>
      <span className="question-note__label">
        {question.noteLabel ?? (question.options.length === 0 ? "回答" : "补充说明（可选）")}
      </span>
      <input
        className="question-note__input"
        id={id}
        type={answerType(question)}
        autoComplete="off"
        spellCheck={question.secret !== true}
        disabled={!ready}
        value={draft.noteText}
        placeholder={ready ? question.noteDescription ?? fallback : "先选择一项"}
        onChange={(event) => {
          update({ ...draft, noteText: event.target.value })
        }}
      />
    </label>
  )
}

export function QuestionField(props: Props): React.JSX.Element {
  const { question, index, prefix, draft, update } = props
  const multi = question.multiSelect === true
  const bodyId = question.body === undefined ? undefined : `${prefix}-body-${String(index)}`
  const external = question.external === undefined ? undefined : safeExternalUrl(question.external.url)
  return (
    <fieldset className="question-field" aria-describedby={bodyId}>
      <legend className="question-field__legend">
        {question.header === undefined ? null : (
          <span className="question-field__header">{question.header}</span>
        )}
        <span>{question.question}</span>
        {question.optional === true ? <span className="question-field__optional">可跳过</span> : null}
      </legend>
      {question.body === undefined ? null : (
        <p className="question-field__body" id={bodyId}>{question.body}</p>
      )}
      {external === undefined ? null : (
        <a className="question-field__external" href={external.url} target="_blank" rel="noreferrer noopener">
          <strong>{external.host}</strong>
          <span>{external.url}</span>
          {question.external?.warning === undefined ? null : <em>{question.external.warning}</em>}
        </a>
      )}
      <div className="question-field__options">
        {question.options.map((option) => (
          <label className="question-option" key={option.id}>
            <input
              className="question-option__control"
              type={multi ? "checkbox" : "radio"}
              name={`${prefix}-choice-${String(index)}`}
              checked={draft.optionIds.includes(option.id)}
              onChange={(event) => {
                update({
                  ...draft,
                  optionIds: multi ? optionIds(draft, option.id, event.target.checked) : [option.id],
                  ...(multi ? {} : { other: false }),
                })
              }}
            />
            <span className="question-option__copy">
              <span>{option.label}</span>
              {option.description === undefined ? null : (
                <span className="question-option__desc">{option.description}</span>
              )}
              {option.preview === undefined ? null : (
                <pre className="question-option__preview">{option.preview}</pre>
              )}
            </span>
          </label>
        ))}
        <OtherAnswer {...props} />
        <NoteAnswer {...props} />
        {question.options.length === 0 && question.allowOther !== true && question.allowNote !== true ? (
          <p className="question-field__empty">没有可选项，可以跳过这组问题。</p>
        ) : null}
      </div>
    </fieldset>
  )
}
