import type { ModelOption } from "@switchback/protocol"
import type { Locale } from "@switchback/i18n"
import type { EnginePick } from "../../shared/settings.js"
import { effortLabel } from "./ModelPicker.js"
import { Select, type Choice, type Section } from "./Select.js"
import { SparkIcon } from "./icons.js"
import { useLocale } from "../i18n.js"
import { ENGINE_PREFERENCE } from "./EnginePreference.messages.js"

/** 几个小函数共用的：眼下的选择、选了之后怎么办、说哪种语言。 */
interface Ctx {
  pick: EnginePick | undefined
  onPick: (pick: EnginePick | undefined) => void
  locale: Locale
}

export function EnginePreference({
  pick,
  models,
  disabled,
  onPick,
}: {
  pick: EnginePick | undefined
  models: readonly ModelOption[]
  disabled: boolean
  onPick: (pick: EnginePick | undefined) => void
}): React.JSX.Element {
  const locale = useLocale()
  const m = ENGINE_PREFERENCE[locale]
  const current = models.find((model) => model.id === pick?.model)
  const sections = sectionsOf(models, current, { pick, onPick, locale })
  return (
    <div className="eng-pref">
      <Select
        label={summaryOf(current, pick, locale)}
        icon={<SparkIcon />}
        title={m.tip}
        disabled={disabled}
        sections={sections}
        reset={
          pick === undefined ? undefined : { label: m.engineDefault, run: () => onPick(undefined) }
        }
      />
    </div>
  )
}

function sectionsOf(models: readonly ModelOption[], current: ModelOption | undefined, ctx: Ctx): readonly Section[] {
  const model = modelSectionOf(models, current, ctx)
  const effort = effortSectionOf(current, ctx)
  return effort === undefined ? [model] : [model, effort]
}

function modelSectionOf(models: readonly ModelOption[], current: ModelOption | undefined, ctx: Ctx): Section {
  return {
    title: ENGINE_PREFERENCE[ctx.locale].model,
    choices: modelChoices(models, current, ctx),
    value: ctx.pick?.model ?? "",
    onPick: (id) => pickModel(models, id, ctx.onPick),
  }
}

function modelChoices(models: readonly ModelOption[], current: ModelOption | undefined, ctx: Ctx): readonly Choice[] {
  const m = ENGINE_PREFERENCE[ctx.locale]
  const choices: Choice[] = [
    { id: "", label: m.engineDefault, description: m.engineDefaultNote },
    ...models.map((model) => ({
      id: model.id,
      label: model.label,
      ...(model.description === undefined ? {} : { description: model.description }),
    })),
  ]
  if (ctx.pick?.model !== undefined && current === undefined) {
    choices.push({ id: ctx.pick.model, label: ctx.pick.model, note: m.notReported })
  }
  return choices
}

function pickModel(
  models: readonly ModelOption[],
  id: string,
  onPick: (pick: EnginePick | undefined) => void,
): void {
  if (id === "") {
    onPick(undefined)
    return
  }
  const selected = models.find((model) => model.id === id)
  onPick({
    model: id,
    ...(selected?.defaultEffort === undefined ? {} : { effort: selected.defaultEffort }),
  })
}

function effortSectionOf(current: ModelOption | undefined, ctx: Ctx): Section | undefined {
  const { pick, onPick, locale } = ctx
  const m = ENGINE_PREFERENCE[locale]
  const efforts = current?.efforts ?? []
  if (current === undefined || efforts.length === 0) return undefined
  const effortChoices: Choice[] = efforts.map((effort) => ({
    id: effort,
    ...effortLabel(effort, locale),
  }))
  if (pick?.effort !== undefined && !efforts.includes(pick.effort)) {
    effortChoices.push({ id: pick.effort, label: pick.effort, note: m.notReported })
  }
  return {
    title: m.effort,
    value: pick?.effort ?? current.defaultEffort,
    choices: effortChoices,
    onPick: (effort) => onPick({ model: current.id, effort }),
  }
}

function summaryOf(current: ModelOption | undefined, pick: EnginePick | undefined, locale: Locale): string {
  if (pick?.model === undefined) return ENGINE_PREFERENCE[locale].engineDefault
  const model = current?.label ?? pick.model
  const effort = pick.effort ?? current?.defaultEffort
  return effort === undefined ? model : `${model} · ${effortLabel(effort, locale).label}`
}
