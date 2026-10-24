import type { ElicitationRequest, ElicitationResult } from "@anthropic-ai/claude-agent-sdk"
import type { QuestionAnswer, QuestionOption, QuestionPrompt, QuestionResponse } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { sanitize } from "./permission.js"
import { urlPrompt } from "./elicitation-url.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { CLAUDE_ELICITATION } from "./elicitation.messages.js"

type Primitive = string | number | boolean | string[]
type Raw = Readonly<Record<string, unknown>>
type FieldKind = "confirm" | "text" | "number" | "integer" | "boolean" | "single" | "multi"

interface Field {
  id: string
  kind: FieldKind
  required: boolean
  schema: Raw
  prompt: QuestionPrompt
}

interface Form {
  mode: "form" | "url"
  fields: readonly Field[]
  prompts: readonly QuestionPrompt[]
}

interface PromptContext {
  required: boolean
  request: ElicitationRequest
  first: boolean
  m: Text
}

type Text = (typeof CLAUDE_ELICITATION)[Locale]

type Decoded = { content: Record<string, Primitive> } | { field: string; error: string }

const record = (value: unknown): Raw | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Raw : undefined

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined
}

function titledOptions(value: unknown, key: "oneOf" | "anyOf"): readonly QuestionOption[] | undefined {
  const choices = record(value)?.[key]
  if (!Array.isArray(choices)) return undefined
  const options = choices.flatMap((choice) => {
    const row = record(choice)
    return typeof row?.["const"] === "string" && typeof row["title"] === "string"
      ? [{ id: row["const"], label: sanitize(row["title"]) }]
      : []
  })
  return options.length === choices.length && unique(options) ? options : undefined
}

function enumOptions(schema: Raw): readonly QuestionOption[] | undefined {
  const values = stringList(schema["enum"])
  if (values !== undefined) {
    const names = stringList(schema["enumNames"])
    const options = values.map((value, index) => ({ id: value, label: sanitize(names?.[index] ?? value) }))
    return unique(options) && (names === undefined || names.length === values.length) ? options : undefined
  }
  return titledOptions(schema, "oneOf")
}

function multiOptions(schema: Raw): readonly QuestionOption[] | undefined {
  const items = record(schema["items"])
  if (items === undefined) return undefined
  return enumOptions(items) ?? titledOptions(items, "anyOf")
}

function unique(options: readonly QuestionOption[]): boolean {
  return options.length > 0 && new Set(options.map((option) => option.id)).size === options.length
}

function kindOf(schema: Raw, m: Text): { kind: FieldKind; options: readonly QuestionOption[] } | undefined {
  if (schema["type"] === "string") {
    const options = enumOptions(schema)
    const declaresOptions = schema["enum"] !== undefined || schema["oneOf"] !== undefined
    return options === undefined
      ? declaresOptions ? undefined : { kind: "text", options: [] }
      : { kind: "single", options }
  }
  if (schema["type"] === "number" || schema["type"] === "integer") {
    return { kind: schema["type"], options: [] }
  }
  if (schema["type"] === "boolean") {
    return { kind: "boolean", options: [{ id: "true", label: m.yes }, { id: "false", label: m.no }] }
  }
  if (schema["type"] === "array") {
    const options = multiOptions(schema)
    return options === undefined ? undefined : { kind: "multi", options }
  }
  return undefined
}

function serverLabel(request: ElicitationRequest): string {
  const server = sanitize(request.serverName) || "MCP"
  const display = sanitize(request.displayName ?? request.title ?? "")
  return display === "" || display === server ? server : `${display} · ${server}`
}

function details(schema: Raw, m: Text): string {
  const rows: string[] = []
  if (typeof schema["description"] === "string") rows.push(sanitize(schema["description"]))
  const min = finite(schema["minLength"] ?? schema["minimum"] ?? schema["minItems"])
  const max = finite(schema["maxLength"] ?? schema["maximum"] ?? schema["maxItems"])
  if (min !== undefined) rows.push(m.min(min))
  if (max !== undefined) rows.push(m.max(max))
  if (typeof schema["format"] === "string") rows.push(m.format(sanitize(schema["format"])))
  if (typeof schema["pattern"] === "string") rows.push(m.pattern(sanitize(schema["pattern"])))
  if (schema["default"] !== undefined) rows.push(m.fallback(sanitize(JSON.stringify(schema["default"]))))
  return m.join(rows.filter(Boolean))
}

function promptOf(
  id: string,
  schema: Raw,
  ctx: PromptContext,
): Field | undefined {
  const { m } = ctx
  const shape = kindOf(schema, m)
  if (shape === undefined) return undefined
  const name = typeof schema["title"] === "string" ? sanitize(schema["title"]) : sanitize(id)
  const requestDetail = ctx.first ? [sanitize(ctx.request.message), sanitize(ctx.request.description ?? "")] : []
  const context = m.join([...requestDetail, details(schema, m)].filter(Boolean))
  const free = shape.kind === "text" || shape.kind === "number" || shape.kind === "integer"
  const prompt: QuestionPrompt = {
    id,
    header: serverLabel(ctx.request),
    question: name || m.fill,
    options: shape.options,
    ...(context === "" ? {} : { body: context }),
    ...(shape.kind === "multi" ? { multiSelect: true } : {}),
    ...(free ? { allowNote: true, noteLabel: m.answer, noteDescription: m.raw } : {}),
    ...(!ctx.required ? { optional: true } : {}),
  }
  return { id, kind: shape.kind, required: ctx.required, schema, prompt }
}

function confirmation(request: ElicitationRequest, m: Text): Form {
  const prompt: QuestionPrompt = {
    id: "mcp-confirm",
    header: serverLabel(request),
    question: sanitize(request.message) || m.proceed,
    options: [{ id: "accept", label: m.continue }],
    ...(request.description === undefined ? {} : { body: sanitize(request.description) }),
  }
  const field: Field = { id: prompt.id, kind: "confirm", required: true, schema: {}, prompt }
  return { mode: "form", fields: [field], prompts: [prompt] }
}

function urlForm(request: ElicitationRequest, locale: Locale): Form | undefined {
  const prompt = urlPrompt(request, locale)
  if (prompt === undefined) return undefined
  const field: Field = { id: prompt.id, kind: "confirm", required: true, schema: {}, prompt }
  return { mode: "url", fields: [field], prompts: [prompt] }
}

function formOf(request: ElicitationRequest, m: Text): Form | undefined {
  if (request.requestedSchema === undefined) return confirmation(request, m)
  const schema = record(request.requestedSchema)
  const properties = record(schema?.["properties"])
  if (schema?.["type"] !== "object" || properties === undefined) return undefined
  const requiredList = stringList(schema["required"])
  if (schema["required"] !== undefined && requiredList === undefined) return undefined
  const required = new Set(requiredList ?? [])
  const entries = Object.entries(properties)
  if ([...required].some((id) => !Object.hasOwn(properties, id))) return undefined
  if (entries.length === 0) return confirmation(request, m)
  const fields = entries.flatMap(([id, raw], index) => {
    const field = promptOf(id, record(raw) ?? {}, { required: required.has(id), request, first: index === 0, m })
    return field === undefined ? [] : [field]
  })
  return fields.length === entries.length
    ? { mode: "form", fields, prompts: fields.map((field) => field.prompt) }
    : undefined
}

function textAnswer(answer: QuestionAnswer): string | undefined {
  return answer.kind === "note" ? answer.text : undefined
}

function invalid(field: Field, problem: string, m: Text): Decoded {
  return { field: field.id, error: m.invalid(field.prompt.question, problem) }
}

function decodeNumber(field: Field, answer: QuestionAnswer, m: Text): number | Decoded {
  const raw = textAnswer(answer)
  const value = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw)
  if (!Number.isFinite(value)) return invalid(field, m.number, m)
  if (field.kind === "integer" && !Number.isInteger(value)) return invalid(field, m.integer, m)
  const min = finite(field.schema["minimum"])
  const max = finite(field.schema["maximum"])
  if (min !== undefined && value < min) return invalid(field, m.notBelow(min), m)
  return max !== undefined && value > max ? invalid(field, m.notAbove(max), m) : value
}

function decodeText(field: Field, answer: QuestionAnswer, m: Text): string | Decoded {
  const value = textAnswer(answer)
  if (value === undefined) return invalid(field, m.text, m)
  const min = finite(field.schema["minLength"])
  const max = finite(field.schema["maxLength"])
  if (min !== undefined && value.length < min) return invalid(field, m.minLength(min), m)
  return max !== undefined && value.length > max ? invalid(field, m.maxLength(max), m) : value
}

function decodeSingle(field: Field, answer: QuestionAnswer, m: Text): string | Decoded {
  if (answer.kind !== "single") return invalid(field, m.pickOne, m)
  return field.prompt.options.some((option) => option.id === answer.optionId)
    ? answer.optionId : invalid(field, m.unknownOption, m)
}

function decodeMulti(field: Field, answer: QuestionAnswer, m: Text): string[] | Decoded {
  if (answer.kind !== "multi") return invalid(field, m.pickSome, m)
  const ids = [...answer.optionIds]
  const known = new Set(field.prompt.options.map((option) => option.id))
  if (new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) return invalid(field, m.unknownOption, m)
  const min = finite(field.schema["minItems"])
  const max = finite(field.schema["maxItems"])
  if (min !== undefined && ids.length < min) return invalid(field, m.atLeast(min), m)
  return max !== undefined && ids.length > max ? invalid(field, m.atMost(max), m) : ids
}

function decodeBoolean(field: Field, answer: QuestionAnswer, m: Text): boolean | Decoded {
  const value = decodeSingle(field, answer, m)
  return typeof value === "string" ? value === "true" : value
}

function decodeField(field: Field, answer: QuestionAnswer, m: Text): Primitive | undefined | Decoded {
  if (answer.kind === "skipped") return field.required ? invalid(field, m.required, m) : undefined
  switch (field.kind) {
    case "confirm": {
      const value = decodeSingle(field, answer, m)
      return typeof value === "string" ? undefined : value
    }
    case "text":
      return decodeText(field, answer, m)
    case "number":
    case "integer":
      return decodeNumber(field, answer, m)
    case "boolean":
      return decodeBoolean(field, answer, m)
    case "single":
      return decodeSingle(field, answer, m)
    case "multi":
      return decodeMulti(field, answer, m)
  }
}

function decode(form: Form, response: Extract<QuestionResponse, { answers: unknown }>, m: Text): Decoded {
  const content: Record<string, Primitive> = {}
  for (const field of form.fields) {
    const answer = response.answers[field.id]
    if (answer === undefined) return invalid(field, m.missing, m)
    const value = decodeField(field, answer, m)
    if (typeof value === "object" && !Array.isArray(value)) return value
    if (field.kind !== "confirm" && value !== undefined) content[field.id] = value
  }
  return { content }
}

function withError(form: Form, problem: Extract<Decoded, { error: string }>, m: Text): Form {
  const fields = form.fields.map((field) => field.id === problem.field
    ? { ...field, prompt: { ...field.prompt, body: m.join([field.prompt.body, problem.error].filter((part): part is string => Boolean(part))) } }
    : field)
  return { ...form, fields, prompts: fields.map((field) => field.prompt) }
}

/** Claude 公开的 MCP elicitation → Switchback 原生问题卡；不支持的 schema 明确 cancel。 */
export async function answerElicitation(
  request: ElicitationRequest,
  askQuestion: StartRequest["askQuestion"],
  signal: AbortSignal,
  locale: Locale = DEFAULT_LOCALE,
): Promise<ElicitationResult> {
  const m = CLAUDE_ELICITATION[locale]
  const initial = request.mode === "url" ? urlForm(request, locale) : formOf(request, m)
  if (initial === undefined) return { action: "cancel" }
  let form = initial
  while (!signal.aborted) {
    const response = await askQuestion(form.prompts, { signal })
    if ("dismissed" in response) return { action: signal.aborted ? "cancel" : "decline" }
    const result = decode(form, response, m)
    if ("content" in result) {
      return initial.mode === "url" ? { action: "accept" } : { action: "accept", content: result.content }
    }
    form = withError(initial, result, m)
  }
  return { action: "cancel" }
}
