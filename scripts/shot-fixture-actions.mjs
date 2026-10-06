import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** 样本会话开在仓库根目录，侧栏的项目组就叫仓库目录名——clone 下来叫什么就是什么，不写死。 */
const GROUP = basename(join(dirname(fileURLToPath(import.meta.url)), ".."))

/** 把固定样本点开；反复确认展开态，扛住启动期侧栏的异步重绘。 */
export async function openFixture({ value, waitFor, pause }, cdp) {
  const group = `[...document.querySelectorAll('.row--group')].find(row => row.querySelector('.row__label')?.textContent.trim() === ${JSON.stringify(GROUP)})`
  await waitFor(cdp, `${group}?.querySelector('.row__main') !== null`, "项目组")
  const deadline = Date.now() + 20_000
  let selected = false
  while (!selected) {
    if (Date.now() >= deadline) throw new Error("界面没有就绪（会话列表）")
    // 展开与否看组里有没有会话行——组头的展开箭头已按拍板换成开/合文件夹图标，
    // 没有 `.chev--open` 可问了（见 SidebarGroup.tsx）
    if (!(await value(cdp, `${group}?.parentElement?.querySelector('.row--thread .row__main') !== null`))) {
      await value(cdp, `${group}?.querySelector('.row__main')?.click(); true`)
    }
    selected = await value(
      cdp,
      `(() => {
      const row = document.querySelector('.row--thread .row__main')
      if (row === null) return false
      row.click()
      return true
    })()`,
    )
    await pause(120)
  }
  await waitFor(cdp, "document.querySelector('.md') !== null", "转录区正文")
  await pause(900)
}
