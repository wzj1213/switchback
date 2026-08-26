/** 文件拖放的连续场景：提示、接收、拒绝与重复操作必须共用真实文件通道。 */
const MIXED_FILES = [
  "apps/desktop/build/icon.png",
  "apps/desktop/src/renderer/attachment-feedback.ts",
]

export const DROP_VIEWS = [
  {
    name: "14-工作台拖放提示",
    open: `document.querySelector('[title="文件预览"]')?.click()`,
    dragFiles: MIXED_FILES,
    dragTarget: ".workbench__body",
    dragHint: "添加 1 张图片并引用 1 个文件",
    holdDrag: true,
    ready: ".composer-drop--surface",
    assert: `(() => {
      const hint = document.querySelector('.composer-drop--surface')?.getBoundingClientRect()
      const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect()
      return hint !== undefined && sidebar !== undefined
        && Math.abs(hint.left - sidebar.right) < 1 && Math.abs(hint.right - innerWidth) < 1
    })()`,
  },
  {
    name: "14-工作台也能接混合文件",
    open: [],
    ready: ".composer__attachwarn",
    absent: ".workbench:not([hidden])",
    assert: `document.querySelector('.composer__input')?.value
        .includes('@apps/desktop/src/renderer/attachment-feedback.ts') === true
      && document.querySelector('.composer__attachwarn')?.textContent
        .includes('已添加 1 张图片，并引用 1 个文件') === true
      && document.querySelectorAll('.attach .thumb').length === 1
      && document.activeElement?.classList.contains('composer__input') === true`,
  },
  {
    name: "14-重复拖放不制造假成功",
    open: `document.querySelector('[title="文件预览"]')?.click()`,
    dragFiles: MIXED_FILES,
    dragTarget: ".workbench__body",
    dragHint: "添加 1 张图片并引用 1 个文件",
    ready: ".composer-drop--notice",
    assert: `(() => {
      const value = document.querySelector('.composer__input')?.value ?? ''
      const references = value.split('@apps/desktop/src/renderer/attachment-feedback.ts').length - 1
      return document.querySelector('.workbench:not([hidden])') !== null
        && document.querySelector('.composer-drop--notice')?.textContent
          .includes('没有重复添加：2 个文件已经在待发送内容中') === true
        && document.querySelector('.composer__attachwarn') === null
        && document.querySelectorAll('.attach .thumb').length === 1
        && document.querySelector('.transcript')?.tabIndex === 0
        && document.querySelector('.transcript')?.getAttribute('aria-label')?.startsWith('对话记录：') === true
        && references === 1
    })()`,
    after: `return new Promise(resolve => {
      const input = document.querySelector('.composer__input')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(input, '')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('[aria-label="去掉这个附件"]')?.click()
      document.querySelector('.workbench__hide')?.click()
      setTimeout(resolve, 5200)
    })`,
  },
  {
    name: "14-侧栏仍不接文件",
    open: `document.querySelector('[title="文件预览"]')?.click()`,
    dragFiles: ["apps/desktop/src/renderer/attachment-feedback.ts"],
    rejectDragTarget: ".sidebar",
    ready: ".workbench:not([hidden])",
    assert: `document.querySelector('.composer-drop') === null
      && document.querySelector('.composer__input')?.value === ''`,
  },
  {
    name: "14-读取失败不关闭工作台",
    open: `(() => {
      const target = document.querySelector('.workbench__body')
      const transfer = new DataTransfer()
      transfer.items.add(new File(['orphan'], 'orphan.ts', { type: 'text/typescript' }))
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target?.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, dataTransfer: transfer,
        }))
      }
      const settled = () => {
        const notice = document.querySelector('.composer-drop--surface')?.textContent ?? ''
        if (notice.includes('未能读取')) document.documentElement.dataset.failedDrop = 'ready'
        else setTimeout(settled, 30)
      }
      settled()
    })()`,
    ready: "html[data-failed-drop=ready]",
    assert: `document.querySelector('.workbench:not([hidden])') !== null
      && document.querySelector('.composer-drop--surface')?.textContent.includes('未能读取') === true
      && document.querySelector('.composer-drop--notice') !== null
      && document.querySelector('.composer__attachwarn') === null
      && document.querySelector('.composer__input')?.value === ''
      && document.querySelector('.attach .thumb') === null`,
    after: `return new Promise(resolve => {
      delete document.documentElement.dataset.failedDrop
      document.querySelector('.workbench__hide')?.click()
      setTimeout(resolve, 5200)
    })`,
  },
]
