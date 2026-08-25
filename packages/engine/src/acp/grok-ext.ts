/** Grok gateway 的私有方法既可能只加 `_` 前缀，也可能再套一层 method/params。 */
export function grokExtPayload(
  method: string,
  params: unknown,
  target: string,
): Record<string, unknown> | undefined {
  const outer = recordOf(params)
  if (method === target) return outer
  if (method !== `_${target}`) return undefined
  return outer?.["method"] === target ? recordOf(outer["params"]) : outer
}

export const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
