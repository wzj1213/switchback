/**
 * 端到端验收里「分级 replay」那一段。
 *
 * 单独一个文件是行数闸门逼的，但边界也对：它自带一套样本（要往 journal 目录里
 * 放六条会话），和别的步骤不共享任何状态。
 */
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fixture } from "./e2e-fixture.mjs"

/**
 * 分级 replay：字节预算、只发头、`watch` → `thread` 帧。
 *
 * ## 为什么要往盘上放东西
 *
 * 这个应用**没发过第一句话的会话不落盘**（见 `host/ctx.ts` 的 `uncommitted`），
 * 而这条脚本不会去真跑一轮引擎。于是照原样连过去，磁盘上一条历史都没有，
 * `bodies` 必然是空的——那时候「它是不是数组」这一条等于什么都没验。
 *
 * ## 为什么样本要按**字节**造
 *
 * 第一版这里造的是「5000 条极小的事件」，因为当时预算卡的是条数。
 * 而真机上栽的恰恰是另一头：**九条会话才 3291 条事件，合起来 5.2 MB**——
 * 条数远低于阈值，字节大两个数量级，于是九条全带正文、切成 271 个分片、
 * 手机上一片空白。所以这里的样本必须是「事件不多但每条很大」的那种形状。
 */
export async function stepScoped(send, token, deps) {
  const { evaluate, connect, ok, pause } = deps
  console.log("10. 分级 replay：大小预算、只发头、watch → thread 帧")
  const info = await evaluate(send, "window.switchback.appInfo().then(s => JSON.stringify(s))")
  const dir = join(info.dataDir, "threads")
  await mkdir(dir, { recursive: true })
  // 六条各约 10 万码元。单条封顶 64K、整份预算 192K，所以最近那两三条带
  //（裁过的）正文，更早的必然只发头。**先写的 mtime 早**，于是 t6 最新
  const ids = ["e2e-t1", "e2e-t2", "e2e-t3", "e2e-t4", "e2e-t5", "e2e-t6"]
  for (const id of ids) {
    await writeFile(join(dir, `${id}.jsonl`), fixture(id, 100_000), "utf8")
    await pause(30)
  }

  const { ws, frames } = await connect(token)
  ws.send(JSON.stringify({ type: "hello" }))
  await pause(3500)
  const replay = frames.find((f) => f.type === "replay")
  const bodies = replay?.replay.bodies ?? []
  const events = replay?.replay.events ?? []
  const mine = ids.filter((id) => bodies.includes(id))
  const deferred = ids.filter((id) => !bodies.includes(id))
  ok("**最近那几条带正文**", mine.includes("e2e-t6"), mine.join(" "))
  ok("**更早的只发头**——判据是大小，不是条数", deferred.length > 0, `留下 ${deferred.length} 条`)

  const itemsOf = (id) => events.filter((e) => e.type === "item.started" && e.item.id.startsWith(`${id}-`)).length
  const cold = deferred[0]
  ok("只发头的那条在全量里真的没有正文", itemsOf(cold) === 0, `${cold} → ${itemsOf(cold)} 条`)
  ok("但它还在列表里——头是一条不少的", events.some((e) => (e.type === "thread.started" || e.type === "thread.updated") && e.thread.id === cold))
  ok(
    "**带正文的那条也被裁过**——一条 2.5 MB 的会话足以把整份预算架空",
    itemsOf("e2e-t6") > 0 && itemsOf("e2e-t6") < 100_000 / 1600,
    `e2e-t6 → ${itemsOf("e2e-t6")} 条`,
  )

  const count = () => frames.filter((f) => f.type === "thread").length
  ws.send(JSON.stringify({ type: "watch", threadId: "e2e-t6" }))
  await pause(900)
  ok("**已经带了正文的那条不重复补**——这正是分级要省掉的东西", count() === 0)
  ws.send(JSON.stringify({ type: "watch", threadId: cold }))
  await pause(2500)
  const patch = frames.find((f) => f.type === "thread")
  ok("**打开只发头的那条，正文补上来了**", patch?.threadId === cold, `${patch?.events.length ?? 0} 条`)
  ws.send(JSON.stringify({ type: "watch", threadId: "根本没有这条" }))
  await pause(900)
  ok("要一条不存在的会话，不发空帧也不断连接", count() === 1)
  ws.send(JSON.stringify({ type: "ping" }))
  await pause(400)
  ok("连接还活着", frames.some((f) => f.type === "pong"))

  ws.close()
  for (const id of ids) await rm(join(dir, `${id}.jsonl`), { force: true })
}
