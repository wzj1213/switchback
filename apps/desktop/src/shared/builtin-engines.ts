/**
 * 桌面端验过的五家内置引擎。
 *
 * 驱动仍由 `main/registry.ts` 注册；这里共享的是稳定的 id、顺序和人话名。
 * 设置页必须能画出尚未接入的 DSH，因此不能只依赖宿主当前发出来的可见清单。
 */
export const BUILTIN_ENGINES = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "kimi", label: "Kimi Code" },
  { id: "grok", label: "Grok" },
  { id: "dsh", label: "DSH" },
] as const

export type BuiltinEngineId = (typeof BUILTIN_ENGINES)[number]["id"]

export const BUILTIN_ENGINE_LABELS: Readonly<Record<BuiltinEngineId, string>> = Object.fromEntries(
  BUILTIN_ENGINES.map((engine) => [engine.id, engine.label]),
) as Record<BuiltinEngineId, string>

export function isBuiltinEngine(id: string): id is BuiltinEngineId {
  return BUILTIN_ENGINES.some((engine) => engine.id === id)
}
