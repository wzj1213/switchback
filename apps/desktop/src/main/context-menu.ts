import { BrowserWindow, Menu, clipboard, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from "electron"

/**
 * 右键菜单。
 *
 * ## 为什么非要自己接一份
 *
 * **Electron 不给默认右键菜单。** 浏览器里那套「复制 / 粘贴 / 全选」是 Chrome 自己画的，
 * 不在 Electron 里；不接的话右键**什么都不弹**。而「选中一段话 → 右键 → 复制」
 * 恰恰是大多数人复制文字唯一会走的那条路——⌘C 归菜单栏那条 accelerator 管，
 * 可没人会为了复制一句话先去翻菜单栏，右键弹不出东西就等于「这段话拿不走」。
 *
 * ## 只做这几类，一律走 role
 *
 * 1. **能编辑的地方**（输入框）：剪切 / 复制 / 粘贴 / 全选。启用与否照
 *    `params.editFlags` 走——空剪贴板上摆一个能点的「粘贴」是骗人。
 * 2. **选中了文字**：复制。
 * 3. **右键落在链接上**：复制链接地址。
 *
 * 用 `role` 而不是自己 `clipboard.writeText`：系统自己本地化、自己接原生行为
 * （撤销栈、输入法的候选、拼写检查），手写只会做得更差（同 `menu.ts` 那条）。
 * 唯一手写的是「复制链接地址」——它没有对应的 role。
 *
 * ## 不往里塞 Switchback 自己的动作
 *
 * 右键菜单是**系统级的东西**，人对它的预期就是上面这几条。塞「审核」「接力」进去，
 * 代价是此后每一次右键都要先读一遍菜单才知道要点哪个——而那几个动作在界面上
 * 本来就各有各的入口。都不适用时**不弹**，也不弹一个只有灰项的空壳。
 */

/** 这一次右键该给哪几项。给不出来就是空数组，调用方据此不弹。 */
export function contextItems(params: ContextMenuParams): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (params.linkURL !== "") {
    items.push({
      label: "复制链接地址",
      click: () => {
        clipboard.writeText(params.linkURL)
      },
    })
  }
  if (params.isEditable) {
    if (items.length > 0) items.push({ type: "separator" })
    items.push(
      { role: "cut", label: "剪切", enabled: params.editFlags.canCut },
      { role: "copy", label: "复制", enabled: params.editFlags.canCopy },
      { role: "paste", label: "粘贴", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll", label: "全选" },
    )
    return items
  }
  // 不可编辑的地方只认「手上有选中的东西」：右键空白处弹一个只有灰项的菜单，
  // 比不弹更让人以为是坏的
  if (params.selectionText.trim() !== "") {
    if (items.length > 0) items.push({ type: "separator" })
    items.push({ role: "copy", label: "复制" })
  }
  return items
}

/** 给一个窗口接上右键菜单。**每扇窗口各接一次**，跟着 webContents 走。 */
export function installContextMenu(contents: WebContents): void {
  contents.on("context-menu", (_event, params) => {
    const items = contextItems(params)
    if (items.length === 0) return
    const window = BrowserWindow.fromWebContents(contents)
    Menu.buildFromTemplate(items).popup(window === null ? {} : { window })
  })
}
