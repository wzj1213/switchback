import type { ModelOption } from "@omni/protocol"
import type { EnginePick } from "../../shared/settings.js"
import { effortLabel } from "./ModelPicker.js"
import { Select, type Choice, type Section } from "./Select.js"
import { SparkIcon } from "./icons.js"

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
  const current = models.find((model) => model.id === pick?.model)
  const sections = sectionsOf(models, current, pick, onPick)
  return (
    <div className="eng-pref">
      <Select
        label={summaryOf(current, pick)}
        icon={<SparkIcon />}
        title="新会话沿用的模型与思考档"
        disabled={disabled}
        sections={sections}
        reset={
          pick === undefined ? undefined : { label: "跟随引擎默认", run: () => onPick(undefined) }
        }
      />
    </div>
  )
}

function sectionsOf(
  models: readonly ModelOption[],
  current: ModelOption | undefined,
  pick: EnginePick | undefined,
  onPick: (pick: EnginePick | undefined) => void,
): readonly Section[] {
  const model = modelSectionOf(models, current, pick, onPick)
  const effort = effortSectionOf(current, pick, onPick)
  return effort === undefined ? [model] : [model, effort]
}

function modelSectionOf(
  models: readonly ModelOption[],
  current: ModelOption | undefined,
  pick: EnginePick | undefined,
  onPick: (pick: EnginePick | undefined) => void,
): Section {
  return {
    title: "模型",
    choices: modelChoices(models, current, pick),
    value: pick?.model ?? "",
    onPick: (id) => pickModel(models, id, onPick),
  }
}

function modelChoices(
  models: readonly ModelOption[],
  current: ModelOption | undefined,
  pick: EnginePick | undefined,
): readonly Choice[] {
  const choices: Choice[] = [
    { id: "", label: "跟随引擎默认", description: "不向新会话指定模型或思考档" },
    ...models.map((model) => ({
      id: model.id,
      label: model.label,
      ...(model.description === undefined ? {} : { description: model.description }),
    })),
  ]
  if (pick?.model !== undefined && current === undefined) {
    choices.push({ id: pick.model, label: pick.model, note: "本次未报告" })
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

function effortSectionOf(
  current: ModelOption | undefined,
  pick: EnginePick | undefined,
  onPick: (pick: EnginePick | undefined) => void,
): Section | undefined {
  const efforts = current?.efforts ?? []
  if (current === undefined || efforts.length === 0) return undefined
  const effortChoices: Choice[] = efforts.map((effort) => ({
    id: effort,
    ...effortLabel(effort),
  }))
  if (pick?.effort !== undefined && !efforts.includes(pick.effort)) {
    effortChoices.push({ id: pick.effort, label: pick.effort, note: "本次未报告" })
  }
  return {
    title: "思考档",
    value: pick?.effort ?? current.defaultEffort,
    choices: effortChoices,
    onPick: (effort) => onPick({ model: current.id, effort }),
  }
}

function summaryOf(current: ModelOption | undefined, pick: EnginePick | undefined): string {
  if (pick?.model === undefined) return "跟随引擎默认"
  const model = current?.label ?? pick.model
  const effort = pick.effort ?? current?.defaultEffort
  return effort === undefined ? model : `${model} · ${effortLabel(effort).label}`
}
