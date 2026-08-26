/**
 * 固定视觉验收页面。
 *
 * `open` 把界面摆成那一屏，`ready` 证明它真的摆好了；少任意一个都可能
 * 把“点击没生效”拍成一张看似正常的重复截图。
 */
export const VIEWS = [
    { name: "01-转录区", open: null, ready: ".md" },
    {
      name: "02-拖拽拒绝提示",
      open: `(() => {
        const transfer = new DataTransfer()
        transfer.items.add(new File(["const nope = true"], "code.ts", { type: "text/typescript" }))
        window.__omniShotTransfer = transfer
        document.querySelector('.composer__inner')?.dispatchEvent(
          new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }),
        )
      })()`,
      ready: ".composer-drop--blocked",
      assert: `document.querySelector('.composer-drop')?.textContent.includes('工作区文件请用 @ 引用')`,
      after: `(() => {
        const target = document.querySelector('.composer__inner')
        target?.dispatchEvent(new DragEvent('dragleave', {
          bubbles: true, dataTransfer: window.__omniShotTransfer,
        }))
        delete window.__omniShotTransfer
      })()`,
    },
    {
      name: "03-后台活动工作台",
      open: [
        `document.querySelector('[title="后台活动"]')?.click()`,
        `document.querySelector('.activity-row')?.click()`,
      ],
      ready: ".activity-detail",
    },
    {
      name: "04-文件清单",
      open: `document.querySelector('[title="文件预览"]')?.click()`,
      ready: ".file-row",
      assert: `getComputedStyle(document.querySelector('.workbench__scrim')).display === (window.innerWidth <= 1120 ? 'block' : 'none')
        && !document.querySelector('.files-index')?.textContent.includes('failed-secret.txt')`,
    },
    {
      name: "05-缺失文件可恢复",
      open: `[...document.querySelectorAll('.file-row')].find(x => x.textContent.includes('missing-output.txt'))?.click()`,
      ready: ".file-preview .workbench__empty",
      assert: `(() => {
        const preview = document.querySelector('.file-preview')
        return preview?.textContent.includes('文件已经不存在') === true
          && preview.querySelector('[aria-label="重新读取文件"]') !== null
          && preview.querySelector('[aria-label="在访达中显示"]') === null
      })()`,
    },
    {
      name: "06-文件搜索",
      open: [
        `document.querySelector('.workbench__back')?.click()`,
        `(() => {
        const input = document.querySelector('.files-search input')
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, 'attachment')
        input?.dispatchEvent(new Event('input', { bubbles: true }))
      })()`,
        `(() => {
          const enterResults = () => {
            const input = document.querySelector('.files-search input')
            if (document.querySelector('.file-row') !== null) {
              input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
              return
            }
            setTimeout(enterResults, 50)
          }
          enterResults()
        })()`,
      ],
      ready: ".file-row",
      assert: `document.activeElement?.classList.contains('file-row') === true
        && document.activeElement.textContent.toLowerCase().includes('attachment')`,
      after: `document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )`,
    },
    {
      name: "07-工作区外文件预览",
      open: `[...document.querySelectorAll('.file-row')].find(x => x.textContent.includes('会话碰过的工作区外文件.md'))?.click()`,
      ready: ".file-source",
    },
    {
      name: "08-HTML预览",
      open: [
        `document.querySelector('.workbench__back')?.click()`,
        `[...document.querySelectorAll('.file-row')].find(x => x.textContent.includes('旁路侧栏-原型.html'))?.click()`,
      ],
      ready: ".html-preview__frame",
    },
    {
      name: "09-切会话保留草稿",
      open: [
        `document.querySelector('[aria-label="收起工作台"]')?.click()`,
        `(() => {
          const input = document.querySelector('.composer__input')
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          setter?.call(input, '切回来还要在这里')
          input?.dispatchEvent(new Event('input', { bubbles: true }))
          const raw = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
          const transfer = new DataTransfer()
          transfer.items.add(new File([Uint8Array.from(raw, c => c.charCodeAt(0))], 'draft.png', { type: 'image/png' }))
          const paste = new Event('paste', { bubbles: true, cancelable: true })
          Object.defineProperty(paste, 'clipboardData', { value: transfer })
          input?.dispatchEvent(paste)
        })()`,
        `(() => {
          const cycle = () => {
            if (document.querySelector('.attach .thumb') === null) {
              setTimeout(cycle, 50)
              return
            }
            setTimeout(() => {
              const selected = document.querySelector('.row--thread.row--selected .row__main')
              window.__omniDraftThread = selected?.textContent.trim()
              const other = [...document.querySelectorAll('.row--thread .row__main')]
                .find(row => row !== selected)
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
      after: `(() => {
        const input = document.querySelector('.composer__input')
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(input, '')
        input?.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('[aria-label="去掉这个附件"]')?.click()
        delete document.documentElement.dataset.draftRestored
        delete window.__omniDraftThread
      })()`,
    },
    {
      name: "10-新会话",
      open: `document.querySelector('.sidebar__new')?.click()`,
      ready: ".blank__title",
      // 同一 cwd 也不能把上一条任务的文件详情带进来；文件索引可以继续开着。
      absent: ".file-preview",
    },
    {
      name: "11-@文件引用",
      open: [
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
        `if (document.querySelector('.workbench') !== null) throw new Error('Esc 没有收起工作台'); document.querySelector('[title="文件预览"]')?.click()`,
        `document.querySelector('.workbench__scrim')?.click()`,
        `if (document.querySelector('.workbench') !== null) throw new Error('点击遮罩没有收起工作台')`,
        `(() => {
          const input = document.querySelector('.composer__input')
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          setter?.call(input, '@attachment')
          input?.dispatchEvent(new Event('input', { bubbles: true }))
        })()`,
      ],
      ready: ".mentions__row",
      assert: `[...document.querySelectorAll('.mentions__row')].some(row => row.textContent.toLowerCase().includes('attachment'))`,
      after: `(() => {
        const input = document.querySelector('.composer__input')
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(input, '')
        input?.dispatchEvent(new Event('input', { bubbles: true }))
      })()`,
    },
    {
      name: "12-推理强度",
      before: ".effort .trigger:not(:disabled)",
      open: `document.querySelector('.effort .trigger:not(:disabled)')?.click()`,
      ready: ".effort__bar--grown",
      dragEffort: true,
    },
    {
      name: "13-设置",
      // 有账号时侧栏底部先开菜单，没账号时直接进设置；固定样本走前者。
      open: [
        `(() => { const b=document.querySelector('.foot__who'); b?.focus(); b?.click() })()`,
        `[...document.querySelectorAll('[role=menuitem]')].find(m => m.textContent.includes('设置'))?.click()`,
      ],
      ready: ".set",
    },
]
