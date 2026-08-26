/** Composer、图片与后续入口的固定场景；从主清单拆出，避免验收脚本再次长成大文件。 */
import { MODEL_VIEWS } from "./shot-views-model.mjs"

export const COMPOSE_VIEWS = [
  {
    name: "12-切会话保留草稿",
    open: [
      `return new Promise((resolve, reject) => { document.querySelector('[aria-label="收起工作台"]')?.click(); setTimeout(() => { document.activeElement?.getAttribute('title') === '后台活动' ? resolve(true) : reject(new Error('工作台关闭后没有回到原触发器')) }, 80) })`,
      `return new Promise((resolve, reject) => {
        const input = document.querySelector('.composer__input')
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(input, '切回来还要在这里')
        input?.dispatchEvent(new Event('input', { bubbles: true }))
        const canvas = document.createElement('canvas')
        canvas.width = 960; canvas.height = 540
        const draw = canvas.getContext('2d')
        if (draw === null) { reject(new Error('固定图片画布不可用')); return }
        draw.fillStyle = '#f7f7f8'; draw.fillRect(0, 0, 960, 540)
        draw.fillStyle = '#18181b'; draw.font = '700 64px sans-serif'; draw.fillText('omni 同文', 72, 118)
        draw.fillStyle = '#71717a'; draw.font = '32px sans-serif'; draw.fillText('图片预览 · 键盘闭环', 72, 178)
        draw.fillStyle = '#ffffff'; draw.strokeStyle = '#d4d4d8'; draw.lineWidth = 3
        draw.roundRect(72, 252, 816, 178, 24); draw.fill(); draw.stroke()
        draw.fillStyle = '#d97706'; draw.fillRect(108, 294, 68, 68)
        draw.fillStyle = '#27272a'; draw.font = '30px sans-serif'; draw.fillText('文件与图片都在输入区确认', 208, 340)
        canvas.toBlob((blob) => {
          if (blob === null) { reject(new Error('固定图片生成失败')); return }
          const transfer = new DataTransfer()
          transfer.items.add(new File([blob], 'draft.png', { type: 'image/png' }))
          const paste = new Event('paste', { bubbles: true, cancelable: true })
          Object.defineProperty(paste, 'clipboardData', { value: transfer })
          input?.dispatchEvent(paste)
          resolve(true)
        }, 'image/png')
      })`,
      `(() => {
        const cycle = () => {
          if (document.querySelector('.attach .thumb') === null) { setTimeout(cycle, 50); return }
          setTimeout(() => {
            const selected = document.querySelector('.row--thread.row--selected .row__main')
            window.__omniDraftThread = selected?.textContent.trim()
            const other = [...document.querySelectorAll('.row--thread .row__main')].find(row => row !== selected)
            other?.click()
            setTimeout(() => {
              [...document.querySelectorAll('.row--thread .row__main')]
                .find(row => row.textContent.trim() === window.__omniDraftThread)?.click()
              setTimeout(() => { document.documentElement.dataset.draftRestored = 'true' }, 250)
            }, 250)
          }, 100)
        }
        cycle()
      })()`,
    ],
    ready: `html[data-draft-restored="true"]`,
    assert: `document.querySelector('.composer__input')?.value === '切回来还要在这里'
      && document.querySelector('.attach .thumb') !== null`,
  },
  {
    name: "13-图片查看器",
    audit: true,
    open: `(() => { const trigger = document.querySelector('.thumb__hit'); window.__omniImageTrigger = trigger; trigger?.focus(); trigger?.click() })()`,
    ready: `.lightbox[aria-modal="true"]`,
    assert: `(() => {
      const dialog = document.querySelector('.lightbox')
      const close = document.querySelector('.lightbox__close')
      const initial = document.activeElement === close && dialog?.getAttribute('role') === 'dialog'
      dialog?.focus()
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
      const backwards = document.activeElement === close
      close?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
      return initial && backwards && document.activeElement === close
        && dialog?.getAttribute('aria-label')?.startsWith('图片预览：') === true
    })()`,
    after: `return new Promise((resolve, reject) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      setTimeout(() => {
        if (document.querySelector('.lightbox') !== null || document.activeElement !== window.__omniImageTrigger) {
          reject(new Error('图片查看器关闭后没有回到缩略图'))
          return
        }
        ;(async () => {
          const thumb = document.querySelector('.attach .thumb')
          const name = thumb?.getAttribute('title')
          if (name === null || name === undefined) throw new Error('找不到待移除图片的文件名')
          const info = await window.omni.appInfo()
          const path = info.dataDir.replace(/[\\\\/]$/, '') + '/attachments/' + name
          const input = document.querySelector('.composer__input')
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          setter?.call(input, '')
          input?.dispatchEvent(new Event('input', { bubbles: true }))
          document.querySelector('[aria-label="去掉这个附件"]')?.click()
          for (let attempt = 0; attempt < 40; attempt += 1) {
            if (await window.omni.thumb(path, 16) === undefined) break
            await new Promise(done => setTimeout(done, 50))
            if (attempt === 39) throw new Error('移除图片后，本地草稿副本仍然存在')
          }
          delete document.documentElement.dataset.draftRestored
          delete window.__omniDraftThread
          delete window.__omniImageTrigger
        })().then(resolve, reject)
      }, 80)
    })`,
  },
  {
    name: "14-新会话",
    open: `document.querySelector('.sidebar__new')?.click()`,
    ready: ".blank__title",
    absent: ".file-preview",
    assert: `document.activeElement?.classList.contains('composer__input') === true && document.querySelector('[aria-label="添加文件或图片"]')?.disabled === false`,
  },
  {
    name: "14-工作台拖放提示",
    open: `document.querySelector('[title="文件预览"]')?.click()`,
    dragFiles: ["apps/desktop/src/renderer/attachment-feedback.ts"],
    dragTarget: ".workbench__body",
    holdDrag: true,
    ready: ".composer-drop--surface",
    assert: `(() => {
      const hint = document.querySelector('.composer-drop--surface')?.getBoundingClientRect()
      const main = document.querySelector('.main')?.getBoundingClientRect()
      return hint !== undefined && main !== undefined
        && Math.abs(hint.left - main.left) < 1 && Math.abs(hint.right - innerWidth) < 1
    })()`,
  },
  {
    name: "14-工作台也能接文件",
    open: [],
    ready: ".composer__attachwarn",
    absent: ".workbench:not([hidden])",
    assert: `document.querySelector('.composer__input')?.value
        .includes('@apps/desktop/src/renderer/attachment-feedback.ts') === true
      && document.querySelector('.composer__attachwarn')?.textContent.includes('已引用 1 个文件') === true
      && document.activeElement?.classList.contains('composer__input') === true`,
    after: `(() => {
      const input = document.querySelector('.composer__input')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(input, '')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })()`,
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
    name: "15-工作台文件预览",
    open: [
      `(() => { const input = document.querySelector('.composer__input'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, '检查这个文件 '); input?.dispatchEvent(new Event('input', { bubbles: true })) })()`,
      `document.querySelector('[title="文件预览"]')?.click()`,
      `(() => { const input = document.querySelector('.files-search input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, 'attachment-feedback'); input?.dispatchEvent(new Event('input', { bubbles: true })) })()`,
      `[...document.querySelectorAll('.file-row')].find(x => x.textContent.includes('attachment-feedback.ts'))?.click()`,
      `setTimeout(() => { window.dispatchEvent(new Event('focus')); const see = () => { if (document.querySelector('.file-preview__status')?.textContent.includes('正在更新')) document.documentElement.dataset.fileRefresh = String(document.querySelector('.file-source') !== null && document.querySelector('[aria-label="引用到输入框"]')?.disabled === false); else setTimeout(see, 10) }; see() }, 320)`,
    ],
    ready: `html[data-file-refresh]`,
    assert: `document.documentElement.dataset.fileRefresh === 'true'
      && document.querySelector('.file-preview__path')?.textContent.includes('…/src/renderer') === true`,
  },
  {
    name: "16-工作台文件加入输入框",
    open: `document.querySelector('[aria-label="引用到输入框"]')?.click()`,
    ready: ".composer__input",
    absent: ".workbench:not([hidden])",
    assert: `document.activeElement?.classList.contains('composer__input') === true
      && document.querySelector('.composer__input')?.value === '检查这个文件 @apps/desktop/src/renderer/attachment-feedback.ts '
      && document.querySelector('.send')?.disabled === false`,
    after: `(() => { const input = document.querySelector('.composer__input'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, ''); input?.dispatchEvent(new Event('input', { bubbles: true })) })()`,
  },
  {
    name: "17-@文件引用",
    open: [
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      `if (document.querySelector('.workbench:not([hidden])') !== null) throw new Error('Esc 没有收起工作台'); document.querySelector('[title="文件预览"]')?.click()`,
      `document.querySelector('.workbench__scrim')?.click()`,
      `if (document.querySelector('.workbench:not([hidden])') !== null) throw new Error('点击遮罩没有收起工作台')`,
      `(() => { const input = document.querySelector('.composer__input'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, '@attachment'); input?.dispatchEvent(new Event('input', { bubbles: true })) })()`,
    ],
    ready: ".mentions__row",
    assert: `[...document.querySelectorAll('.mentions__row')].some(row => row.textContent.toLowerCase().includes('attachment'))`,
    after: `(() => { const input = document.querySelector('.composer__input'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, ''); input?.dispatchEvent(new Event('input', { bubbles: true })) })()`,
  },
  {
    name: "17-即时确认文件引用",
    open: `(() => {
      const input = document.querySelector('.composer__input')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      input?.focus()
      setter?.call(input, '@attachment')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      setTimeout(() => input?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true,
      })), 0)
      const settled = () => {
        const value = input?.value ?? ''
        if (value !== '@attachment' && value.includes('attachment') && document.querySelector('.mentions') === null) {
          document.documentElement.dataset.mentionCommitted = 'true'
        } else setTimeout(settled, 30)
      }
      setTimeout(settled, 30)
    })()`,
    ready: `html[data-mention-committed="true"]`,
    assert: `document.querySelector('.composer__input')?.value.startsWith('@') === true
      && document.querySelector('.composer__input')?.value.endsWith(' ') === true
      && document.querySelector('.send')?.disabled === false`,
    after: `(() => {
      delete document.documentElement.dataset.mentionCommitted
      const input = document.querySelector('.composer__input')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(input, '')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })()`,
  },
  ...MODEL_VIEWS,
  {
    name: "19-设置",
    open: [
      `(() => { const b=document.querySelector('.foot__who'); b?.focus(); b?.click() })()`,
      `[...document.querySelectorAll('[role=menuitem]')].find(m => m.textContent.includes('设置'))?.click()`,
    ],
    ready: ".set",
  },
]
