/** 大段粘贴折成一枚芯片；单开一个文件是行数闸门逼的，同 `shot-view-completion.mjs`。 */
export const PASTE_VIEW = {
  /*
   * **大段粘贴折成一枚芯片。**
   *
   * 输入框最高 180px；粘一段几百行的日志进去，它就此变成一个只能滚的小窗口，
   * 你要在里面找自己那句话。折起来的只是显示——发送时它原样接在正文后面
   *（`composer-blocks.ts` 的 `composeDraft`）。
   *
   * 顺带验一件容易回退的事：**折起来之后正文仍然可以正常打字**，
   * 而且发送键不是灰的（只挂一枚芯片、一个字没打也该能发）。
   */
  name: "17-大段粘贴折成芯片",
  open: `(() => {
      const input = document.querySelector('.composer__input')
      input?.focus()
      const transfer = new DataTransfer()
      transfer.setData('text/plain', Array.from({ length: 42 }, (_, i) => 'ERR ' + (i + 1) + ' 连接被拒绝').join(String.fromCharCode(10)))
      const paste = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(paste, 'clipboardData', { value: transfer })
      input?.dispatchEvent(paste)
    })()`,
  ready: ".dblock",
  assert: `document.querySelector('.dblock__name')?.textContent === '粘贴文本 · 42 行'
      && document.querySelector('.composer__input')?.value === ''
      && document.querySelector('.dblock')?.title.startsWith('ERR 1 连接被拒绝') === true
      && document.querySelector('.send')?.disabled === false`,
  after: `(() => {
      for (const x of document.querySelectorAll('.dblock__x')) x.click()
    })()`,
}
