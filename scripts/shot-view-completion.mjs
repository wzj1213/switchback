/** 输入候选的反向 Tab 场景；单列避免 composer 视觉清单越过 300 行。 */
export const REVERSE_COMPLETION_VIEW = {
  name: "17-反向离开文件候选",
  open: [
    `(() => { const input = document.querySelector('.composer__input'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; input?.focus(); setter?.call(input, '@attachment'); input?.dispatchEvent(new Event('input', { bubbles: true })) })()`,
    `(() => {
      const input = document.querySelector('.composer__input')
      const before = input?.value
      const reverse = new KeyboardEvent('keydown', {
        key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
      })
      document.documentElement.dataset.reverseCompletionPass = String(
        input?.dispatchEvent(reverse) === true
          && input?.value === before
          && document.querySelector('.mentions') === null,
      )
    })()`,
  ],
  ready: `html[data-reverse-completion-pass="true"]`,
  assert: `document.querySelector('.composer__input')?.value === '@attachment'
    && document.querySelector('.mentions') === null`,
  after: `(() => {
    delete document.documentElement.dataset.reverseCompletionPass
    const input = document.querySelector('.composer__input')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(input, '')
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })()`,
}
