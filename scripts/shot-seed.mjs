import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { mainThread, noRepoThread, stubThread } from "./ui-fixture.mjs"
import { longThread } from "./ui-performance-fixture.mjs"

export async function seedUi(dir, { ROOT, WORK, AT, DARK, ENGINE, PET_LIVE, STRESS }) {
  const threads = join(dir, "threads")
  const external = join(dir, "会话碰过的工作区外文件.md")
  await mkdir(threads, { recursive: true })
  await writeFile(external, "# 工作区外文件\n\n这份文件由固定样本模拟引擎读过。\n")
  await writeFile(join(threads, "th-shot.jsonl"), STRESS
    ? longThread("th-shot", ROOT, AT) : mainThread("th-shot", ROOT, AT, external))
  const stubs = [
    ["th-a", "修一下这个空断言", AT - 3 * 3600_000],
    ["th-b", "看一下断线重连那条链路", AT - 8 * 3600_000],
    ["th-c", "codex 昨天在 x 上说的那个", AT - 3 * 86_400_000],
  ]
  for (const [id, title, at] of stubs)
    await writeFile(join(threads, `${id}.jsonl`), stubThread(id, title, ROOT, at))
  // 工作区不是 Git 仓库的那条：那张「已编辑 N 个文件」的卡在 git 工作区里会被核销掉。
  // **固定名字**（侧栏按目录名分组，随机后缀会让每次出图的侧栏都不一样），
  // 而且**不放在数据目录里面**——它是个被应用监听的工作区，收尾时和数据目录
  // 一起删会互相踩（实测 `ENOTEMPTY`）
  const noRepo = join(WORK, "临时工作区")
  await mkdir(noRepo, { recursive: true })
  // 「工作区外」那一条给一个**本仓库里的**路径：既不在会话工作区里，也不是临时草稿
  await writeFile(
    join(threads, "th-norepo.jsonl"),
    noRepoThread("th-norepo", noRepo, AT - 5 * 3600_000, join(ROOT, "AGENTS.md")),
  )
  await writeFile(
    join(dir, "settings.json"),
    `${JSON.stringify({
      projects: [ROOT],
      ...(ENGINE === undefined ? {} : { defaultEngine: ENGINE }),
      theme: DARK ? "dark" : "light",
      pets: true,
      ...(PET_LIVE ? { defaultEngine: "claude", petKit: { range: true } } : {}),
    })}\n`,
  )
}

