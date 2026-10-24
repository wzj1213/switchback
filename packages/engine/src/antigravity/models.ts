import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { ModelOption } from "@switchback/protocol"

/** agy models 的公开输出是 slug + TAB + 名称；不从名称推断强度或默认模型。 */
export function parseModels(output: string): readonly ModelOption[] {
  const models = new Map<string, ModelOption>()
  for (const line of output.split(/\r?\n/)) {
    const [id, ...rest] = line.split("\t")
    const label = rest.join("\t").trim()
    if (id === undefined || !/^[a-z0-9][a-z0-9._-]*$/.test(id) || label === "") continue
    models.set(id, { id, label, inputModalities: ["text"] })
  }
  return [...models.values()]
}

export async function readModels(command: string): Promise<readonly ModelOption[]> {
  const { stdout } = await promisify(execFile)(command, ["models"], { timeout: 20_000, maxBuffer: 1024 * 1024 })
  return parseModels(stdout)
}
