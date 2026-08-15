import { ipcMain, type BrowserWindow, type WebContents } from "electron"

export interface FindResult {
  /** 第几个命中，从 1 开始；没有命中是 0 */
  active: number
  total: number
}

export interface FindRequest {
  query: string
  forward?: boolean
  next?: boolean
}

const EMPTY: FindResult = { active: 0, total: 0 }

/**
 * 一次查找。
 *
 * `findInPage` 是**异步**的：它返回一个 requestId，结果通过 `found-in-page`
 * 事件回来。必须按 requestId 对上——同时按住回车连发几次时，
 * 不对 id 就会把上一次的计数当成这一次的。
 *
 * ⚠️ **`findNext: false` 不会发 `found-in-page`。** 这条是实测出来的，
 * 文档里没有：连发两次 `findNext: false` 都超时无响应，紧接着一次
 * `findNext: true` 立刻返回 `matches: 3`，之后再发 `findNext: false` 也正常了——
 * 也就是说「新建搜索」这条路要等一个已存在的会话才报数。
 * 界面上的表现是查找条永远显示 `0/0` 并标红，看起来像一个字都没匹配上。
 *
 * 所以这里**一律传 `findNext: true`**；「从头开始找」用先 `stopFindInPage`
 * 清掉会话来表达，效果一样而且真的会报数。
 */
function once(contents: WebContents, request: FindRequest): Promise<FindResult> {
  // 不是「下一个」就是一次新的查询：清掉旧会话，让它从第一个命中开始
  if (request.next !== true) contents.stopFindInPage("clearSelection")
  return new Promise<FindResult>((resolve) => {
    const requestId = contents.findInPage(request.query, {
      forward: request.forward ?? true,
      findNext: true,
      matchCase: false,
    })
    const onFound = (_e: unknown, result: { requestId: number; activeMatchOrdinal: number; matches: number }): void => {
      if (result.requestId !== requestId) return
      contents.off("found-in-page", onFound)
      resolve({ active: result.activeMatchOrdinal, total: result.matches })
    }
    contents.on("found-in-page", onFound)
  })
}

/**
 * 会话内查找。
 *
 * 用 Chromium 原生的 `findInPage` 而不是自己在 item 模型上匹配：
 * transcript 里有 Markdown 渲染出来的元素树、代码块、diff，
 * 自己做匹配就要自己做高亮和滚动定位，而且**永远追不上渲染层的变化**——
 * 每加一种呈现形态就要补一次。原生的那份对屏幕上真实存在的文本生效。
 *
 * 代价：它搜的是**整个窗口**，因此侧栏的会话预览、以及查找框自己的输入值
 * 都会被算进命中数。查过能不能排除掉查找框：
 * `display:none` / `visibility:hidden` / `content-visibility:hidden` / `inert`
 * 的内容确实不计入，但这四种都会让输入框**不可输入**——
 * 中文 IME 需要一个真正获得焦点的 input，为一个计数牺牲中文输入不划算。
 * 所以保留，并在界面上把「计数覆盖整个窗口」这件事说出来。
 */
export function installFind(windows: () => readonly BrowserWindow[]): void {
  const focused = (): WebContents | undefined => {
    const win = windows().find((w) => !w.isDestroyed())
    return win?.webContents
  }

  ipcMain.handle("omni:find", async (_e, request: FindRequest): Promise<FindResult> => {
    const contents = focused()
    if (contents === undefined) return EMPTY
    if (request.query === "") {
      contents.stopFindInPage("clearSelection")
      return EMPTY
    }
    return once(contents, request)
  })

  ipcMain.on("omni:stopFind", () => {
    // clearSelection 而不是 keepSelection：关掉查找条之后还留着一段黄色高亮，
    // 会让人以为选中了什么
    focused()?.stopFindInPage("clearSelection")
  })
}
