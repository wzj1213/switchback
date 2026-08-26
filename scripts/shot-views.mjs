/**
 * 固定视觉验收页面。
 *
 * `open` 把界面摆成那一屏，`ready` 证明它真的摆好了；少任意一个都可能
 * 把“点击没生效”拍成一张看似正常的重复截图。
 */
export const VIEWS = [
    { name: "01-转录区", open: null, ready: ".md" },
    {
      name: "02-桌宠固定地面",
      open: `(() => {
        const pet = document.querySelector('.pet--on') ?? document.querySelector('.pet')
        const brief = document.querySelector('.brief')
        if (pet === null || brief === null) {
          document.documentElement.dataset.petGround = 'false'
          return
        }
        const before = pet.getBoundingClientRect().bottom
        const probe = document.createElement('div')
        probe.style.cssText = 'height:72px;width:1px;flex:none'
        brief.append(probe)
        setTimeout(() => {
          const after = pet.getBoundingClientRect().bottom
          const composer = document.querySelector('.composer')?.getBoundingClientRect().top
          probe.remove()
          const petTop = Math.min(...[...document.querySelectorAll('.pet')]
            .map(node => node.getBoundingClientRect().top))
          const briefBottom = brief.getBoundingClientRect().bottom
          document.documentElement.dataset.petGround = String(
            composer !== undefined && Math.abs(after - before) < 2 && Math.abs(after - composer) < 10
              && briefBottom <= petTop,
          )
        }, 180)
      })()`,
      ready: `html[data-pet-ground]`,
      assert: `document.documentElement.dataset.petGround === 'true'`,
      after: `delete document.documentElement.dataset.petGround`,
    },
    {
      name: "03-环境信息",
      open: `document.querySelector('.topbar__title')?.click()`,
      ready: ".env",
      assert: `document.querySelector('.env')?.textContent.includes('AGENTS.md') === true`,
      after: `document.querySelector('.topbar__title')?.click()`,
    },
    {
      name: "04-Git审核",
      open: `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === '审核')?.click()`,
      ready: ".rv .rvd__body",
      assert: `document.querySelector('.rv__file') !== null
        && !document.querySelector('.rv__pane')?.textContent.includes('读取当前净补丁失败')
        && (window.innerWidth > 1000 || (() => {
          const title = document.querySelector('.rv__title')?.getBoundingClientRect()
          const tools = document.querySelector('.rv__tools')?.getBoundingClientRect()
          const buttons = [...document.querySelectorAll('.rv__seg')].map(button => button.getBoundingClientRect())
          return title !== undefined && tools !== undefined && tools.top >= title.bottom
            && buttons.every(button => button.height < 40 && button.width > 24)
        })())`,
      after: `document.querySelector('.rv__close')?.click()`,
    },
    {
      name: "05-拖入工作区文件",
      open: [
        `document.querySelector('.sidebar__new')?.click()`,
        `if (document.querySelector('.blank__title') === null) throw new Error('新会话没有就绪')`,
        `if (!document.activeElement?.classList.contains('composer__input')) throw new Error('新会话没有聚焦输入框'); document.querySelector('.sidebar__filter')?.focus()`,
      ],
      dragFiles: ["apps/desktop/src/renderer/attachment-feedback.ts"],
      ready: ".composer__attachwarn",
      assert: `document.querySelector('.composer__input')?.value
          .includes('@apps/desktop/src/renderer/attachment-feedback.ts') === true
        && document.querySelector('.composer__attachwarn')?.textContent.includes('已引用 1 个文件') === true
        && document.querySelector('.attach .thumb') === null
        && document.querySelector('.send')?.disabled === false
        && document.activeElement?.classList.contains('composer__input') === true`,
      after: `(() => {
        const input = document.querySelector('.composer__input')
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(input, '')
        input?.dispatchEvent(new Event('input', { bubbles: true }))
        ;[...document.querySelectorAll('.row--thread .row__main')]
          .find(row => row.textContent.includes('useFlow'))?.click()
      })()`,
    },
    {
      name: "06-后台活动工作台",
      open: [
        `document.querySelector('[title="后台活动"]')?.click()`,
        `document.querySelector('.activity-row')?.click()`,
      ],
      ready: ".activity-detail",
    },
    {
      name: "07-文件清单",
      open: `document.querySelector('[title="文件预览"]')?.click()`,
      ready: ".file-row",
      assert: `getComputedStyle(document.querySelector('.workbench__scrim')).display === (window.innerWidth <= 1120 ? 'block' : 'none')
        && !document.querySelector('.files-index')?.textContent.includes('failed-secret.txt')
        && document.querySelector('.files-scope')?.textContent.includes('搜索范围是当前工作区') === true
        && document.querySelector('.files-index')?.textContent.includes('最近一轮改过') === true
        && document.querySelector('.files-index')?.textContent.includes('此前碰过') === true
        && document.querySelector('.files-index')?.textContent.includes('AGENTS.md') === true`,
    },
    {
      name: "08-缺失文件可恢复",
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
      name: "09-文件搜索",
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
      name: "10-工作区外文件预览",
      open: `[...document.querySelectorAll('.file-row')].find(x => x.textContent.includes('会话碰过的工作区外文件.md'))?.click()`,
      ready: ".file-source",
    },
    {
      name: "11-HTML预览",
      open: [
        `document.querySelector('.workbench__back')?.click()`,
        `[...document.querySelectorAll('.file-row')].find(x => x.textContent.includes('旁路侧栏-原型.html'))?.click()`,
      ],
      ready: ".html-preview__frame",
    },
    {
      name: "12-切会话保留草稿",
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
      after: `(async () => {
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
          await new Promise(resolve => setTimeout(resolve, 50))
          if (attempt === 39) throw new Error('移除图片后，本地草稿副本仍然存在')
        }
        delete document.documentElement.dataset.draftRestored
        delete window.__omniDraftThread
      })()`,
    },
    {
      name: "13-新会话",
      open: `document.querySelector('.sidebar__new')?.click()`,
      ready: ".blank__title",
      // 同一 cwd 也不能把上一条任务的文件详情带进来；文件索引可以继续开着。
      absent: ".file-preview",
      assert: `document.activeElement?.classList.contains('composer__input') === true`,
    },
    {
      name: "14-@文件引用",
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
      name: "15-推理强度",
      before: ".effort .trigger:not(:disabled)",
      open: `document.querySelector('.effort .trigger:not(:disabled)')?.click()`,
      ready: ".effort__bar--grown",
      dragEffort: true,
    },
    {
      name: "16-设置",
      // 有账号时侧栏底部先开菜单，没账号时直接进设置；固定样本走前者。
      open: [
        `(() => { const b=document.querySelector('.foot__who'); b?.focus(); b?.click() })()`,
        `[...document.querySelectorAll('[role=menuitem]')].find(m => m.textContent.includes('设置'))?.click()`,
      ],
      ready: ".set",
    },
]
