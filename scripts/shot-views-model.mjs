/** 模型菜单与推理强度场景；和输入内容场景分开，避免固定页面清单越过行数闸门。 */
export const MODEL_VIEWS = [
  {
    name: "18-模型菜单焦点",
    before: ".composer__bar .trigger:not(:disabled)",
    open: `(() => {
      const triggers = [...document.querySelectorAll('.composer__bar .trigger:not(:disabled)')]
      const model = triggers.find(button => button.textContent.includes('Default')) ?? triggers.at(-1)
      model?.click()
      setTimeout(() => {
        const menu = document.querySelector('.pop [role="menu"]')
        menu?.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowDown', bubbles: true, cancelable: true,
        }))
        const held = document.activeElement
        const input = document.querySelector('.composer__input')
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(input, '触发父级重渲染')
        input?.dispatchEvent(new Event('input', { bubbles: true }))
        setTimeout(() => {
          document.documentElement.dataset.modelFocus = JSON.stringify({
            same: document.activeElement === held,
            heldRole: held?.getAttribute('role'),
            heldText: held?.textContent.trim(),
            currentRole: document.activeElement?.getAttribute('role'),
            currentText: document.activeElement?.textContent.trim(),
            menuOpen: document.querySelector('.pop [role="menu"]') !== null,
          })
        }, 80)
      }, 80)
    })()`,
    ready: `html[data-model-focus]`,
    assert: `(() => {
      const result = JSON.parse(document.documentElement.dataset.modelFocus ?? '{}')
      if (result.same === true && result.heldRole === 'menuitem') return true
      throw new Error('模型菜单焦点诊断：' + JSON.stringify(result))
    })()`,
    after: `(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true,
      }))
      delete document.documentElement.dataset.modelFocus
      const input = document.querySelector('.composer__input')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(input, '')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })()`,
  },
  {
    name: "18-超长模型名不出界",
    before: ".composer__bar .trigger:not(:disabled):not(.trigger--open)",
    open: `(() => {
      const triggers = [...document.querySelectorAll('.composer__bar .trigger:not(:disabled)')]
      const model = triggers.find(button => button.textContent.includes('Default')) ?? triggers.at(-1)
      model?.click()
      setTimeout(() => {
        const panel = document.querySelector('.pop')
        const value = panel?.querySelector('.pop__value')
        const label = 'enterprise-reasoning-model-with-extended-context-and-recommended-safety-profile-v2026-preview-'.repeat(3)
        if (value !== null && value !== undefined) {
          value.textContent = label
          value.title = label
        }
        setTimeout(() => {
          const rect = panel?.getBoundingClientRect()
          document.documentElement.dataset.popoverBounds = JSON.stringify({
            inside: rect !== undefined && rect.left >= 7 && rect.right <= innerWidth - 7,
            noHorizontalScroll: panel !== null && panel.scrollWidth <= panel.clientWidth + 1,
            fullLabelAvailable: value?.title === label,
            left: rect?.left,
            right: rect?.right,
            viewport: innerWidth,
            clientWidth: panel?.clientWidth,
            scrollWidth: panel?.scrollWidth,
          })
        }, 120)
      }, 80)
    })()`,
    ready: `html[data-popover-bounds]`,
    assert: `(() => {
      const result = JSON.parse(document.documentElement.dataset.popoverBounds ?? '{}')
      if (result.inside && result.noHorizontalScroll && result.fullLabelAvailable) return true
      throw new Error('超长模型名浮层诊断：' + JSON.stringify(result))
    })()`,
    after: `(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true,
      }))
      delete document.documentElement.dataset.popoverBounds
    })()`,
  },
  {
    name: "18-推理强度",
    before: ".effort .trigger:not(:disabled):not(.trigger--open)",
    open: `document.querySelector('.effort .trigger:not(:disabled)')?.click()`,
    ready: ".effort__bar--grown",
    dragEffort: true,
  },
]
