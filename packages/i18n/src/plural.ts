/**
 * 英文的单复数：`count(1, "file")` → `1 file`，`count(3, "file")` → `3 files`。
 * 不规则的复数自己给第三个参数（`count(2, "entry", "entries")`）。中文没有单复数，用不上它。
 */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`
}
