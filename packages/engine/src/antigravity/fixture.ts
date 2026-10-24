import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Event } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"

/** 测试用原生进程替身；验证真实 pipe、EOF、退出和进程回收，不访问服务端。 */
const script = String.raw`#!/usr/bin/env node
const { createInterface } = require("node:readline")
const args = process.argv.slice(2)
if (args[0] === "--version") { process.stdout.write("agy 1.4.0\n"); process.exit(0) }
if (args[0] === "models") { process.stdout.write("test-model\tTest model\n"); process.exit(0) }
const flag = (name) => args[args.indexOf(name) + 1]
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n")
createInterface({ input: process.stdin }).on("line", (line) => {
  const content = JSON.parse(line).message.content
  if (content === "auth") { process.stderr.write("Account ineligible: not available in your location\n"); process.exitCode = 1; return }
  if (content === "malformed") { process.stdout.write("not json\n"); return }
  send({ event: "init", conversation_id: "conversation-1", init: { permission_mode: "accept-edits", model: "test-model" } })
  if (content === "slow") { setInterval(() => {}, 1000); return }
  const response = content === "resume" ? flag("--conversation") : content
  send({ event: "step_update", step_update: { step_index: 2, step_type: "agent_response", state: "ACTIVE", text_delta: response } })
  send({ event: "step_update", step_update: { step_index: 2, step_type: "agent_response", state: "DONE", text_delta: "!" } })
  send({ event: "result", result: { conversation_id: "conversation-1", status: "SUCCESS", response: response + "!" } })
})
`

export async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "switchback-agy-"))
  const command = join(dir, "agy")
  await writeFile(command, script, { mode: 0o700 })
  const events: Event[] = []
  const handles: string[] = []
  const req: StartRequest = {
    threadId: "thread", cwd: dir, trust: "auto-edit", home: dir,
    memory: () => [], emit: (event) => events.push(event), onHandle: (handle) => handles.push(handle),
    askUser: async () => { throw new Error("不应伪造审批回路") }, // i18n-ok：测试替身里给测试看的断言
    askQuestion: async () => { throw new Error("不应伪造提问回路") }, // i18n-ok：同上
  }
  return { command, req, events, handles, cleanup: () => rm(dir, { recursive: true, force: true }) }
}
