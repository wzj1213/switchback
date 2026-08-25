import type { ModelOption } from "@omni/protocol"

/** 选中项的退路必须和模型面板一致，避免面板与附件入口各认一台模型。 */
export function currentModel(
  models: readonly ModelOption[],
  model: string | undefined,
): ModelOption | undefined {
  return models.find((candidate) => candidate.id === model)
    ?? models.find((candidate) => candidate.isDefault === true)
    ?? models[0]
}

/** 目录明确说当前模型没有 image 时才禁用；旧目录没报模态仍保持兼容。 */
export function modelAcceptsImages(
  models: readonly ModelOption[],
  model: string | undefined,
): boolean {
  const modalities = currentModel(models, model)?.inputModalities
  return modalities === undefined || modalities.includes("image")
}
